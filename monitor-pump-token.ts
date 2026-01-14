// Monitor any pump.fun token - Get past and current transactions
// Usage: npx ts-node monitor-pump-token.ts <TOKEN_MINT_ADDRESS>

import { Connection, PublicKey } from '@solana/web3.js';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

interface TransactionRecord {
  signature: string;
  timestamp: number;
  type: 'BUY' | 'SELL' | 'UNKNOWN';
  solAmount: number;
  tokenAmount: number;
  wallet: string;
}

class PumpTokenMonitor {
  private mintAddress: string;
  private apiKey: string;
  private connection: Connection;
  private ws: WebSocket | null = null;
  private processedSignatures = new Set<string>();
  private transactionHistory: TransactionRecord[] = [];
  private pumpProgramId: PublicKey;

  constructor(mintAddress: string) {
    this.mintAddress = mintAddress;
    
    // Get API key from .env
    const rpcEndpoint = process.env.RPC_ENDPOINT || '';
    const apiKeyMatch = rpcEndpoint.match(/api-key=([^&]+)/);
    this.apiKey = apiKeyMatch ? apiKeyMatch[1] : '';
    
    if (!this.apiKey) {
      throw new Error('Helius API key not found in RPC_ENDPOINT');
    }
    
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
      'confirmed'
    );
    
    this.pumpProgramId = new PublicKey(PUMP_PROGRAM_ID);
  }

  async initialize() {
    console.log(`\n🔍 Initializing monitor for token: ${this.mintAddress}`);
    console.log(`📍 Pump.fun Program: ${PUMP_PROGRAM_ID}\n`);
    
    // Step 1: Get past transactions
    await this.getPastTransactions();
    
    // Step 2: Start real-time monitoring
    this.startRealTimeMonitoring();
  }

  async getPastTransactions(limit = 50) {
    console.log('📜 Fetching past transactions...');
    
    try {
      const mintPubkey = new PublicKey(this.mintAddress);
      
      // Get recent transactions from Pump.fun program
      const signatures = await this.connection.getSignaturesForAddress(
        this.pumpProgramId,
        { limit: 500 }
      );
      
      console.log(`   Found ${signatures.length} Pump.fun transactions, filtering for your token...`);
      
      const relevantTxs: TransactionRecord[] = [];
      let checked = 0;
      
      for (const sigInfo of signatures.slice(0, limit)) {
        checked++;
        if (checked % 10 === 0) {
          process.stdout.write(`   Checking ${checked}/${limit}...\r`);
        }
        
        try {
          const tx = await this.connection.getParsedTransaction(
            sigInfo.signature,
            { maxSupportedTransactionVersion: 0 }
          );
          
          if (!tx || !tx.meta) continue;
          
          // Check if transaction involves our token
          const accountKeys = tx.transaction.message.accountKeys || [];
          let hasOurToken = false;
          
          for (const key of accountKeys) {
            const addr = typeof key === 'string' 
              ? key 
              : (key.pubkey ? key.pubkey.toString() : key.toString());
            if (addr === this.mintAddress) {
              hasOurToken = true;
              break;
            }
          }
          
          // Also check token balances
          if (!hasOurToken) {
            const tokenBalances = [
              ...(tx.meta.preTokenBalances || []),
              ...(tx.meta.postTokenBalances || [])
            ];
            hasOurToken = tokenBalances.some(bal => bal.mint === this.mintAddress);
          }
          
          if (hasOurToken) {
            const txRecord = this.analyzeTransaction(tx, sigInfo.signature, sigInfo.blockTime || 0);
            if (txRecord) {
              relevantTxs.push(txRecord);
              this.processedSignatures.add(sigInfo.signature);
            }
          }
        } catch (error) {
          // Skip failed fetches
          continue;
        }
      }
      
      console.log(`\n✅ Found ${relevantTxs.length} past transactions for this token\n`);
      
      // Display past transactions
      relevantTxs.forEach((tx, idx) => {
        const date = new Date(tx.timestamp * 1000).toLocaleString();
        console.log(`${idx + 1}. [${tx.type}] ${tx.signature.slice(0, 16)}... | ${tx.solAmount.toFixed(4)} SOL | ${date}`);
      });
      
      this.transactionHistory = relevantTxs;
      
    } catch (error) {
      console.error('❌ Error fetching past transactions:', error);
    }
  }

  startRealTimeMonitoring() {
    console.log('\n🔴 Starting real-time monitoring...');
    console.log('   (Press Ctrl+C to stop)\n');
    
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to Helius WebSocket');
      
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [PUMP_PROGRAM_ID]
          },
          {
            commitment: 'confirmed'
          }
        ]
      };
      
      this.ws!.send(JSON.stringify(subscribeMessage));
    });
    
    this.ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.id === 1 && message.result) {
          console.log('✅ Subscribed to Pump.fun logs');
          console.log('👂 Listening for transactions...\n');
          return;
        }
        
        if (message.method === 'logsNotification' && message.params) {
          const { result } = message.params;
          if (result?.value?.signature) {
            const signature = result.value.signature;
            
            if (this.processedSignatures.has(signature)) {
              return;
            }
            
            // Fetch and check transaction
            try {
              const tx = await this.connection.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
              });
              
              if (!tx || !tx.meta) return;
              
              // Check if involves our token
              const accountKeys = tx.transaction.message.accountKeys || [];
              let hasOurToken = false;
              
              for (const key of accountKeys) {
                const addr = typeof key === 'string'
                  ? key
                  : (key.pubkey ? key.pubkey.toString() : key.toString());
                if (addr === this.mintAddress) {
                  hasOurToken = true;
                  break;
                }
              }
              
              if (!hasOurToken) {
                const tokenBalances = [
                  ...(tx.meta.preTokenBalances || []),
                  ...(tx.meta.postTokenBalances || [])
                ];
                hasOurToken = tokenBalances.some(bal => bal.mint === this.mintAddress);
              }
              
              if (hasOurToken) {
                this.processedSignatures.add(signature);
                const timestamp = Math.floor(Date.now() / 1000);
                const txRecord = this.analyzeTransaction(tx, signature, timestamp);
                
                if (txRecord) {
                  this.transactionHistory.unshift(txRecord);
                  if (this.transactionHistory.length > 1000) {
                    this.transactionHistory.pop();
                  }
                  
                  // Display new transaction
                  const date = new Date().toLocaleString();
                  console.log(`\n🎯 NEW TRANSACTION DETECTED!`);
                  console.log(`   Type: ${txRecord.type}`);
                  console.log(`   Signature: ${signature}`);
                  console.log(`   Wallet: ${txRecord.wallet.slice(0, 16)}...`);
                  console.log(`   Amount: ${txRecord.solAmount.toFixed(4)} SOL`);
                  console.log(`   Time: ${date}`);
                  console.log(`   Total transactions: ${this.transactionHistory.length}\n`);
                }
              }
            } catch (error) {
              // Transaction might not be available yet
            }
          }
        }
      } catch (error) {
        // Ignore parse errors
      }
    });
    
    this.ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
    });
    
    this.ws.on('close', () => {
      console.log('\n⚠️  WebSocket closed, reconnecting in 5s...');
      setTimeout(() => {
        this.startRealTimeMonitoring();
      }, 5000);
    });
  }

  analyzeTransaction(tx: any, signature: string, timestamp: number): TransactionRecord | null {
    try {
      const meta = tx.meta;
      const accountKeys = tx.transaction.message.accountKeys || [];
      
      if (!accountKeys.length) return null;
      
      // Get wallet (first signer)
      const firstKey = accountKeys[0];
      const wallet = typeof firstKey === 'string'
        ? firstKey
        : (firstKey.pubkey ? firstKey.pubkey.toString() : firstKey.toString());
      
      // Find wallet index
      let walletIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        const key = accountKeys[i];
        const addr = typeof key === 'string'
          ? key
          : (key.pubkey ? key.pubkey.toString() : key.toString());
        if (addr === wallet) {
          walletIndex = i;
          break;
        }
      }
      
      // Get SOL balance changes
      let preSolBalance = 0;
      let postSolBalance = 0;
      if (walletIndex >= 0 && meta.preBalances && meta.postBalances) {
        preSolBalance = (meta.preBalances[walletIndex] || 0) / 1e9;
        postSolBalance = (meta.postBalances[walletIndex] || 0) / 1e9;
      }
      
      // Get token balance changes
      const preTokenBalance = this.getTokenBalance(meta.preTokenBalances, wallet, this.mintAddress);
      const postTokenBalance = this.getTokenBalance(meta.postTokenBalances, wallet, this.mintAddress);
      
      // Determine type
      let type: 'BUY' | 'SELL' | 'UNKNOWN' = 'UNKNOWN';
      let solAmount = Math.abs(preSolBalance - postSolBalance);
      let tokenAmount = 0;
      
      if (postTokenBalance > preTokenBalance) {
        type = 'BUY';
        tokenAmount = postTokenBalance - preTokenBalance;
      } else if (postTokenBalance < preTokenBalance) {
        type = 'SELL';
        tokenAmount = preTokenBalance - postTokenBalance;
      }
      
      // Estimate fees and adjust SOL amount
      const baseFee = 0.000005;
      const estimatedPriorityFee = solAmount > 0.01 ? 0.002 : 0.001;
      const estimatedPumpFunFee = solAmount * 0.02;
      const estimatedFees = baseFee + estimatedPriorityFee + estimatedPumpFunFee;
      
      if (solAmount > estimatedFees) {
        solAmount = solAmount - estimatedFees;
      }
      
      return {
        signature,
        timestamp,
        type,
        solAmount,
        tokenAmount,
        wallet
      };
    } catch (error) {
      return null;
    }
  }

  getTokenBalance(balances: any[], wallet: string, mint: string): number {
    if (!balances || !Array.isArray(balances)) return 0;
    
    for (const balance of balances) {
      if (balance.mint === mint && balance.owner === wallet) {
        return parseFloat(balance.uiTokenAmount?.uiAmount || balance.uiTokenAmount?.amount || 0);
      }
    }
    
    return 0;
  }

  getHistory(): TransactionRecord[] {
    return this.transactionHistory;
  }

  stop() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Main
const mintAddress = process.argv[2];

if (!mintAddress) {
  console.error('❌ Usage: npx ts-node monitor-pump-token.ts <TOKEN_MINT_ADDRESS>');
  process.exit(1);
}

const monitor = new PumpTokenMonitor(mintAddress);
monitor.initialize();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping monitor...');
  monitor.stop();
  process.exit(0);
});
