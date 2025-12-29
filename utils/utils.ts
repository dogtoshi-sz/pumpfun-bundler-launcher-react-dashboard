import { Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import base58 from 'bs58';

dotenv.config();

export const retrieveEnvVariable = (variableName: string, defaultValue: string = '', required: boolean = true) => {
  // First check process.env (can be passed from parent process - no .env file needed)
  const variable = process.env[variableName] || '';
  if (!variable) {
    if (required && !defaultValue) {
      console.log(`${variableName} is not set`);
      process.exit(1);
    }
    return defaultValue;
  }
  return variable;
};

// Define the type for the JSON file content

export const randVal = (min: number, max: number, count: number, total: number, isEven: boolean): number[] => {

  const arr: number[] = Array(count).fill(total / count);
  if (isEven) return arr

  if (max * count < total)
    throw new Error("Invalid input: max * count must be greater than or equal to total.")
  if (min * count > total)
    throw new Error("Invalid input: min * count must be less than or equal to total.")
  const average = total / count
  // Randomize pairs of elements
  for (let i = 0; i < count; i += 2) {
    // Generate a random adjustment within the range
    const adjustment = Math.random() * Math.min(max - average, average - min)
    // Add adjustment to one element and subtract from the other
    arr[i] += adjustment
    arr[i + 1] -= adjustment
  }
  // if (count % 2) arr.pop()
  return arr;
}


// export const saveDataToFile = (newData: string[], filePath: string = "data.json") => {
//   try {
//     let existingData: string[] = [];

//     // Check if the file exists
//     if (fs.existsSync(filePath)) {
//       // If the file exists, read its content
//       const fileContent = fs.readFileSync(filePath, 'utf-8');
//       existingData = JSON.parse(fileContent);
//     }

//     // Add the new data to the existing array
//     existingData.push(...newData);

//     // Write the updated data back to the file
//     fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));

//   } catch (error) {
//     try {
//       if (fs.existsSync(filePath)) {
//         fs.unlinkSync(filePath);
//         console.log(`File ${filePath} deleted and create new file.`);
//       }
//       fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
//       console.log("File is saved successfully.")
//     } catch (error) {
//       console.log('Error saving data to JSON file:', error);
//     }
//   }
// };


export const saveDataToFile = (newData: string[], fileName: string = "data.json") => {
  const folderPath = getDataDirectory();
  const filePath = path.join(folderPath, fileName);

  try {
    // Create the folder if it doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    let existingData: string[] = [];

    // Check if the file exists
    if (fs.existsSync(filePath)) {
      // If the file exists, read its content
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      existingData = JSON.parse(fileContent);
    }

    // Add the new data to the existing array
    existingData.push(...newData);

    // Write the updated data back to the file
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));

    console.log("File is saved successfully.");

  } catch (error) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`File ${filePath} deleted and will be recreated.`);
      }
      fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
      console.log("File is saved successfully.");
    } catch (error) {
      console.log('Error saving data to JSON file:', error);
    }
  }
};


export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// // Function to read JSON file
// export function readJson(filename: string = "data.json"): string[] {
//   if (!fs.existsSync(filename)) {
//     // If the file does not exist, create an empty array
//     fs.writeFileSync(filename, '[]', 'utf-8');
//   }
//   const data = fs.readFileSync(filename, 'utf-8');
//   return JSON.parse(data) as string[];
// }

// Function to read JSON file from the "keys" folder
// Get data directory from env or use default (keys folder in project root)
export function getDataDirectory(): string {
  // Check for DATA_DIR environment variable (for cloud deployments)
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  // Default: keys folder relative to process.cwd()
  return path.join(process.cwd(), 'keys');
}

export function readJson(fileName: string = "data.json"): string[] {
  const folderPath = getDataDirectory();
  const filePath = path.join(folderPath, fileName);

  if (!fs.existsSync(filePath)) {
    // If the file does not exist, create an empty array file in the "keys" folder
    fs.writeFileSync(filePath, '[]', 'utf-8');
  }

  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as string[];
}

// Pump address management functions
interface PumpAddress {
  publicKey: string;
  privateKey: string;
  suffix: string;
  source: string;
  status: string;
  used: boolean;
  usedAt?: string;
}

// Get next available pump address from the pool
export function getNextPumpAddress(): { keypair: Keypair; publicKey: string } | null {
  const folderPath = 'keys';
  const filePath = path.join(folderPath, 'pump-addresses.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const addresses: PumpAddress[] = JSON.parse(data);

    // Find first available address
    const available = addresses.find(addr => 
      addr.status === 'available' && !addr.used
    );

    if (!available) {
      return null;
    }

    // Create keypair from private key
    const keypair = Keypair.fromSecretKey(base58.decode(available.privateKey));
    
    return {
      keypair,
      publicKey: available.publicKey
    };
  } catch (error) {
    console.error('Error reading pump addresses:', error);
    return null;
  }
}

// Mark a pump address as used
export function markPumpAddressAsUsed(publicKey: string): void {
  const folderPath = 'keys';
  const filePath = path.join(folderPath, 'pump-addresses.json');

  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const addresses: PumpAddress[] = JSON.parse(data);

    const address = addresses.find(addr => addr.publicKey === publicKey);
    if (address) {
      address.status = 'used';
      address.used = true;
      address.usedAt = new Date().toISOString();
      
      fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Error marking pump address as used:', error);
  }
}

export function deleteConsoleLines(numLines: number) {
  for (let i = 0; i < numLines; i++) {
    process.stdout.moveCursor(0, -1); // Move cursor up one line
    process.stdout.clearLine(-1);        // Clear the line
  }
}

export function generateVanityAddress(suffix: string): { keypair: Keypair, pubkey: string } {
  // Use multi-threading if available, otherwise fall back to single-threaded
  const numCores = cpus().length;
  const useMultiThread = numCores > 1;

  if (useMultiThread) {
    console.log(`🚀 Using ${numCores} CPU cores for vanity address generation...`);
    return generateVanityAddressMultiThread(suffix, numCores) as any;
  } else {
    console.log('Using single-threaded mode (1 CPU core)...');
    return generateVanityAddressSingleThread(suffix);
  }
}

function generateVanityAddressSingleThread(suffix: string): { keypair: Keypair, pubkey: string } {
  let attempts = 0;
  const startTime = Date.now();

  while (true) {
    const keypair = Keypair.generate();
    const pubkey = keypair.publicKey.toBase58();
    attempts++;

    if (pubkey.endsWith(suffix)) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Match found after ${attempts.toLocaleString()} attempts (single-threaded)`);
      console.log(`⏱️  Time: ${duration} seconds`);
      console.log(`🔑 Public Key: ${pubkey}`);
      return { keypair, pubkey };
    }

    // Optional: Log every 100,000 attempts
    if (attempts % 100_000 === 0) {
      console.log(`Tried ${attempts.toLocaleString()} keys...`);
    }
  }
}

function generateVanityAddressMultiThread(suffix: string, numWorkers: number): Promise<{ keypair: Keypair, pubkey: string }> {
  return new Promise((resolve) => {
    const workers: Worker[] = [];
    let totalAttempts = 0;
    let found = false;
    const startTime = Date.now();
    const workerProgress: { [key: number]: number } = {};

    console.log(`Looking for address ending with: "${suffix}"`);

    // Create worker threads
    for (let i = 0; i < numWorkers; i++) {
      try {
        const workerPath = path.join(__dirname, 'vanity-worker.js');
        const worker = new Worker(workerPath, {
          workerData: { suffix, workerId: i }
        });

        worker.on('message', (message) => {
          if (found) return;

          if (message.success) {
            found = true;
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(`✅ Match found after ${message.attempts.toLocaleString()} attempts by worker ${message.workerId}`);
            console.log(`⏱️  Total time: ${duration} seconds`);
            console.log(`🔑 Public Key: ${message.keypair.publicKey}`);
            
            // Calculate total attempts
            const total = Object.values(workerProgress).reduce((sum, val) => sum + val, 0) + message.attempts;
            console.log(`📊 Total attempts across all workers: ${total.toLocaleString()}`);
            console.log(`⚡ Speed: ~${Math.round(total / parseFloat(duration)).toLocaleString()} keys/second`);
            
            // Terminate all workers
            workers.forEach(w => w.terminate());
            
            // Reconstruct keypair from message
            const keypair = Keypair.fromSecretKey(Buffer.from(message.keypair.secretKey));
            resolve({ keypair, pubkey: message.keypair.publicKey });
          } else if (message.progress) {
            workerProgress[message.workerId] = message.attempts;
            totalAttempts = Object.values(workerProgress).reduce((sum, val) => sum + val, 0);
            
            // Log progress every 500k total attempts
            if (totalAttempts % 500_000 === 0) {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              const speed = Math.round(totalAttempts / parseFloat(elapsed));
              console.log(`📈 Progress: ${totalAttempts.toLocaleString()} total attempts (${speed.toLocaleString()} keys/sec, ${elapsed}s elapsed)`);
            }
          }
        });

        worker.on('error', (error) => {
          console.error(`Worker ${i} error:`, error);
          // If workers fail, fall back to single-threaded
          if (!found) {
            workers.forEach(w => w.terminate());
            console.log('⚠️  Worker error detected, falling back to single-threaded mode...');
            resolve(generateVanityAddressSingleThread(suffix));
          }
        });

        workers.push(worker);
      } catch (error) {
        console.warn(`Failed to create worker ${i}, falling back to single-threaded:`, error);
        if (!found) {
          workers.forEach(w => w.terminate());
          resolve(generateVanityAddressSingleThread(suffix));
        }
        return;
      }
    }
  });
}

function isMatch(pubKey: string, suffix: string): boolean {
  return pubKey.endsWith(suffix);
}
