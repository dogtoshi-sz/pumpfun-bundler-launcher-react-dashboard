/**
 * Profit/Loss Tracker
 * 
 * Tracks funding wallet balance before and after token launches
 * to calculate profit/loss per token and cumulative totals.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';

const PNL_DIR = path.join(process.cwd(), 'keys', 'pnl');
const PROFIT_LOSS_FILE = path.join(PNL_DIR, 'profit-loss.json');

export interface LaunchSettings {
  // Wallet configuration
  usedWarmedWallets: boolean; // Did we use warmed wallets?
  creatorWalletSource: 'warmed' | 'env' | 'auto-created' | 'funding'; // Where did creator wallet come from?
  bundleWalletCount: number; // Number of bundle wallets
  holderWalletCount: number; // Number of holder wallets
  
  // Buy amounts
  devBuyAmount: number; // Creator/DEV wallet buy amount (SOL)
  bundleSwapAmounts: number[]; // Array of bundle wallet amounts
  holderWalletAmount: number; // Holder wallet amount (SOL)
  
  // Feature flags
  autoRapidSell: boolean;
  autoSell50Percent: boolean;
  autoSellStaged: boolean;
  autoGather: boolean;
  websocketTracking: boolean;
  websocketUltraFastMode: boolean;
  
  // Other settings
  jitoFee: number;
  useMixingWallets: boolean;
  useMultiIntermediary: boolean;
  
  // Token info
  tokenImageUrl?: string; // Path or URL to token image
  twitter?: string;
  telegram?: string;
  website?: string;
  description?: string;
}

export interface ProfitLossRecord {
  id: string; // Unique ID for this run
  timestamp: string; // ISO timestamp
  tokenName?: string; // Token name if available
  tokenSymbol?: string; // Token symbol if available
  mintAddress?: string; // Mint address
  balanceBefore: number; // SOL balance before run (in SOL, not lamports)
  balanceAfter: number; // SOL balance after gather (in SOL, not lamports)
  profitLoss: number; // profitLoss = balanceAfter - balanceBefore (in SOL)
  status: 'in_progress' | 'completed' | 'failed'; // Run status
  notes?: string; // Optional notes
  launchSettings?: LaunchSettings; // Launch configuration used
}

export interface ProfitLossData {
  records: ProfitLossRecord[];
  cumulativeProfitLoss: number; // Total profit/loss across all runs (in SOL)
  lastUpdated: string; // ISO timestamp
}

/**
 * Initialize profit/loss data file if it doesn't exist
 */
function initializeDataFile(): void {
  if (!fs.existsSync(PNL_DIR)) {
    fs.mkdirSync(PNL_DIR, { recursive: true });
  }

  if (!fs.existsSync(PROFIT_LOSS_FILE)) {
    const initialData: ProfitLossData = {
      records: [],
      cumulativeProfitLoss: 0,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(PROFIT_LOSS_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * Load profit/loss data from file
 */
function loadData(): ProfitLossData {
  initializeDataFile();

  try {
    const content = fs.readFileSync(PROFIT_LOSS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[ProfitLoss] Error loading data, initializing:', error);
    const initialData: ProfitLossData = {
      records: [],
      cumulativeProfitLoss: 0,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(PROFIT_LOSS_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
}

/**
 * Save profit/loss data to file
 */
function saveData(data: ProfitLossData): void {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROFIT_LOSS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get funding wallet balance in SOL
 */
export async function getFundingWalletBalance(
  connection: Connection,
  fundingWalletPublicKey: PublicKey
): Promise<number> {
  try {
    const balanceLamports = await connection.getBalance(fundingWalletPublicKey);
    return balanceLamports / 1e9; // Convert to SOL
  } catch (error) {
    console.error('[ProfitLoss] Error getting balance:', error);
    throw error;
  }
}

/**
 * Start tracking a new run
 * Call this BEFORE any funds are sent out
 */
export async function startRunTracking(
  connection: Connection,
  fundingWalletPublicKey: PublicKey,
  tokenName?: string,
  tokenSymbol?: string,
  mintAddress?: string,
  launchSettings?: LaunchSettings
): Promise<string> {
  const balanceBefore = await getFundingWalletBalance(connection, fundingWalletPublicKey);
  const runId = `run-${Date.now()}`;

  const record: ProfitLossRecord = {
    id: runId,
    timestamp: new Date().toISOString(),
    tokenName,
    tokenSymbol,
    mintAddress,
    balanceBefore,
    balanceAfter: balanceBefore, // Will be updated when run completes
    profitLoss: 0,
    status: 'in_progress',
    launchSettings,
  };

  const data = loadData();
  data.records.push(record);
  saveData(data);

  console.log(`\n📊 [ProfitLoss] Started tracking run: ${runId}`);
  console.log(`   Balance before: ${balanceBefore.toFixed(4)} SOL`);
  console.log(`   Token: ${tokenName || 'N/A'} (${tokenSymbol || 'N/A'})`);

  return runId;
}

/**
 * Complete tracking for a run
 * Call this AFTER gather completes (or manually if AUTO_GATHER is false)
 */
export async function completeRunTracking(
  connection: Connection,
  fundingWalletPublicKey: PublicKey,
  runId: string,
  status: 'completed' | 'failed' = 'completed',
  notes?: string
): Promise<void> {
  const balanceAfter = await getFundingWalletBalance(connection, fundingWalletPublicKey);

  const data = loadData();
  const record = data.records.find(r => r.id === runId);

  if (!record) {
    console.warn(`[ProfitLoss] Run ${runId} not found, creating new record`);
    // Create a new record if not found (fallback)
    const newRecord: ProfitLossRecord = {
      id: runId,
      timestamp: new Date().toISOString(),
      balanceBefore: balanceAfter, // Best guess
      balanceAfter,
      profitLoss: 0,
      status,
      notes: notes || 'Record created on completion (start tracking was missed)',
    };
    data.records.push(newRecord);
    saveData(data);
    return;
  }

  record.balanceAfter = balanceAfter;
  record.profitLoss = balanceAfter - record.balanceBefore;
  record.status = status;
  if (notes) {
    record.notes = notes;
  }

  // Update cumulative profit/loss
  data.cumulativeProfitLoss = data.records
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + r.profitLoss, 0);

  saveData(data);

  const profitLossSign = record.profitLoss >= 0 ? '+' : '';
  console.log(`\n📊 [ProfitLoss] Completed tracking run: ${runId}`);
  console.log(`   Balance before: ${record.balanceBefore.toFixed(4)} SOL`);
  console.log(`   Balance after:  ${balanceAfter.toFixed(4)} SOL`);
  console.log(`   Profit/Loss:    ${profitLossSign}${record.profitLoss.toFixed(4)} SOL`);
  console.log(`   Cumulative:     ${data.cumulativeProfitLoss >= 0 ? '+' : ''}${data.cumulativeProfitLoss.toFixed(4)} SOL`);
}

/**
 * Get all profit/loss records
 */
export function getAllRecords(): ProfitLossData {
  return loadData();
}

/**
 * Get records for a specific token (by mint address)
 */
export function getRecordsByMint(mintAddress: string): ProfitLossRecord[] {
  const data = loadData();
  return data.records.filter(r => r.mintAddress === mintAddress);
}

/**
 * Get the latest run record
 */
export function getLatestRecord(): ProfitLossRecord | null {
  const data = loadData();
  if (data.records.length === 0) return null;
  return data.records[data.records.length - 1];
}

/**
 * Update launch settings for an existing record
 */
export function updateLaunchSettings(runId: string, launchSettings: LaunchSettings): void {
  const data = loadData();
  const record = data.records.find(r => r.id === runId);
  
  if (record) {
    record.launchSettings = launchSettings;
    saveData(data);
  }
}
