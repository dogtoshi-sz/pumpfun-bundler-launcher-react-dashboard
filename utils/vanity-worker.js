const { parentPort, workerData } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');

const { suffix, workerId } = workerData;
let attempts = 0;

while (true) {
  const keypair = Keypair.generate();
  const pubkey = keypair.publicKey.toBase58();
  attempts++;

  if (pubkey.endsWith(suffix)) {
    parentPort.postMessage({
      success: true,
      keypair: {
        publicKey: pubkey,
        secretKey: Array.from(keypair.secretKey)
      },
      attempts,
      workerId
    });
    break;
  }

  // Report progress every 100,000 attempts
  if (attempts % 100000 === 0) {
    parentPort.postMessage({
      progress: true,
      attempts,
      workerId
    });
  }
}

