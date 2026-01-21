import { Worker } from 'worker_threads';
import { cpus } from 'os';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import base58 from 'bs58';

interface PumpAddress {
  publicKey: string;
  privateKey: string;
  suffix: string;
  source: string;
  status: string;
  used: boolean;
  usedAt?: string;
}

const SUFFIX = 'pump';
const TOTAL_CORES = 14;
const WORKER_REST_INTERVAL = 300000; // 5 minutes rest every cycle
const WORKER_ACTIVE_TIME = 1800000; // 30 minutes active time

const folderPath = 'keys';
const filePath = path.join(folderPath, 'pump-addresses.json');

// Ensure keys folder exists
if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, { recursive: true });
}

// Initialize pump-addresses.json if it doesn't exist
if (!fs.existsSync(filePath)) {
  fs.writeFileSync(filePath, '[]', 'utf-8');
}

// Load existing addresses
function loadAddresses(): PumpAddress[] {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PumpAddress[];
  } catch (error) {
    console.error('Error loading addresses:', error);
    return [];
  }
}

// Save addresses to file (thread-safe with file locking simulation)
function saveAddress(address: PumpAddress): void {
  try {
    const addresses = loadAddresses();
    
    // Check if address already exists
    if (addresses.some(addr => addr.publicKey === address.publicKey)) {
      return;
    }
    
    addresses.push(address);
    fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), 'utf-8');
    
    const availableCount = addresses.filter(addr => addr.status === 'available' && !addr.used).length;
    console.log(`✅ Saved new pump address: ${address.publicKey}`);
    console.log(`📊 Total available addresses: ${availableCount}`);
  } catch (error) {
    console.error('Error saving address:', error);
  }
}

// Create worker pool with alternating rest schedule
class WorkerPool {
  private workers: { [key: number]: Worker } = {};
  private activeWorkers: Set<number> = new Set();
  private restWorkers: Set<number> = new Set();
  private workerStats: Map<number, { found: number; attempts: number; startTime: number }> = new Map();
  private totalFound = 0;
  private totalAttempts = 0;

  constructor() {
    // Initialize all workers as active
    for (let i = 0; i < TOTAL_CORES; i++) {
      this.activeWorkers.add(i);
      this.workerStats.set(i, { found: 0, attempts: 0, startTime: Date.now() });
    }
  }

  start(): void {
    console.log(`🚀 Starting pump address generator with ${TOTAL_CORES} cores`);
    console.log(`📝 Target suffix: "${SUFFIX}"`);
    console.log(`🔄 Workers will alternate rest periods`);
    console.log(`⏰ Active time: ${WORKER_ACTIVE_TIME / 1000 / 60} minutes, Rest time: ${WORKER_REST_INTERVAL / 1000 / 60} minutes\n`);

    // Start all workers
    for (let i = 0; i < TOTAL_CORES; i++) {
      this.startWorker(i);
    }

    // Start rotation schedule
    this.startRotation();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down workers...');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Shutting down workers...');
      this.stop();
      process.exit(0);
    });
  }

  private startWorker(workerId: number): void {
    // Vanity worker is in utils/ directory (root level), not cli/utils/
    const workerPath = path.join(__dirname, '..', 'utils', 'vanity-worker.js');
    const worker = new Worker(workerPath, {
      workerData: { suffix: SUFFIX, workerId }
    });

    worker.on('message', (message) => {
      if (message.success) {
        const { keypair, attempts, workerId: id } = message;
        const stats = this.workerStats.get(id) || { found: 0, attempts: 0, startTime: Date.now() };
        stats.found++;
        stats.attempts += attempts;
        this.workerStats.set(id, stats);
        this.totalFound++;
        this.totalAttempts += attempts;

        // Reconstruct keypair from message
        const secretKey = Buffer.from(keypair.secretKey);
        const kp = Keypair.fromSecretKey(secretKey);
        
        // Save the address
        const address: PumpAddress = {
          publicKey: kp.publicKey.toBase58(),
          privateKey: base58.encode(kp.secretKey),
          suffix: SUFFIX,
          source: 'Vanity generator',
          status: 'available',
          used: false
        };
        saveAddress(address);

        // Restart worker to find another
        worker.terminate();
        setTimeout(() => this.startWorker(id), 100);
      } else if (message.progress) {
        const stats = this.workerStats.get(message.workerId) || { found: 0, attempts: 0, startTime: Date.now() };
        stats.attempts += message.attempts;
        this.workerStats.set(message.workerId, stats);
        this.totalAttempts += message.attempts;
      }
    });

    worker.on('error', (error) => {
      console.error(`❌ Worker ${workerId} error:`, error);
      worker.terminate();
      setTimeout(() => this.startWorker(workerId), 1000);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.log(`⚠️  Worker ${workerId} exited with code ${code}`);
        // Restart worker
        setTimeout(() => this.startWorker(workerId), 1000);
      }
    });

    this.workers[workerId] = worker;
  }

  private startRotation(): void {
    // Initial rotation: start with all active
    setTimeout(() => {
      this.rotateWorkers();
    }, WORKER_ACTIVE_TIME);

    // Continue rotating every cycle
    setInterval(() => {
      this.rotateWorkers();
    }, WORKER_ACTIVE_TIME + WORKER_REST_INTERVAL);
  }

  private rotateWorkers(): void {
    // Rotate workers: move half from active to rest, and rest to active
    const workersToRest = Math.floor(TOTAL_CORES / 2); // Rest half at a time
    const workersToActivate = Math.min(workersToRest, this.restWorkers.size);

    // Move workers to rest
    const workersToRestArray = Array.from(this.activeWorkers).slice(0, workersToRest);
    for (const workerId of workersToRestArray) {
      this.activeWorkers.delete(workerId);
      this.restWorkers.add(workerId);
      if (this.workers[workerId]) {
        this.workers[workerId].terminate();
        delete this.workers[workerId];
      }
    }

    // Move workers from rest to active after rest period
    setTimeout(() => {
      const workersToActivateArray = Array.from(this.restWorkers).slice(0, workersToActivate);
      for (const workerId of workersToActivateArray) {
        this.restWorkers.delete(workerId);
        this.activeWorkers.add(workerId);
        this.startWorker(workerId);
      }
      console.log(`\n🔄 Rotation complete: ${this.activeWorkers.size} active, ${this.restWorkers.size} resting`);
      this.printStats();
    }, WORKER_REST_INTERVAL);
  }

  private printStats(): void {
    const addresses = loadAddresses();
    const availableCount = addresses.filter(addr => addr.status === 'available' && !addr.used).length;
    
    console.log(`\n📊 Statistics:`);
    console.log(`   Total addresses found: ${this.totalFound}`);
    console.log(`   Total available in pool: ${availableCount}`);
    console.log(`   Total attempts: ${this.totalAttempts.toLocaleString()}`);
    console.log(`   Active workers: ${this.activeWorkers.size}`);
    console.log(`   Resting workers: ${this.restWorkers.size}`);
    
    // Per-worker stats
    console.log(`\n   Per-worker stats:`);
    for (const [id, stats] of this.workerStats.entries()) {
      const runtime = (Date.now() - stats.startTime) / 1000 / 60; // minutes
      const rate = stats.attempts / (runtime * 60); // attempts per second
      console.log(`   Worker ${id}: ${stats.found} found, ${stats.attempts.toLocaleString()} attempts, ${rate.toFixed(0)} attempts/sec`);
    }
  }

  private stop(): void {
    for (const workerId in this.workers) {
      this.workers[workerId].terminate();
    }
    this.printStats();
  }
}

// Start the generator
const pool = new WorkerPool();
pool.start();

// Print stats every 5 minutes
setInterval(() => {
  pool['printStats']();
}, 300000);

console.log('💤 Generator running. Press Ctrl+C to stop.\n');

