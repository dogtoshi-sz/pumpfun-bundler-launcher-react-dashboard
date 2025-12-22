import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RPC_ENDPOINT } from "./constants";
import base58 from "bs58";
import fs from "fs";
import path from "path";

const connection = new Connection(RPC_ENDPOINT, "confirmed");

async function findMissingSol() {
  const dataPath = path.join(process.cwd(), 'keys', 'data.json');
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  
  if (!fs.existsSync(dataPath)) {
    console.log("❌ data.json not found");
    return;
  }
  
  const allWallets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const currentRun = fs.existsSync(currentRunPath) 
    ? JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
    : { walletKeys: [] };
  
  const currentRunKeys = new Set(currentRun.walletKeys || []);
  
  console.log(`🔍 Checking ${allWallets.length} wallets for missing SOL...\n`);
  
  let totalMissing = 0;
  const walletsWithSol: Array<{ address: string; balance: number; isCurrentRun: boolean }> = [];
  
  for (let i = 0; i < allWallets.length; i++) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(allWallets[i]));
      const balance = await connection.getBalance(kp.publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      const isCurrentRun = currentRunKeys.has(allWallets[i]);
      
      if (solBalance > 0.001) { // More than just rent
        totalMissing += solBalance;
        walletsWithSol.push({
          address: kp.publicKey.toBase58(),
          balance: solBalance,
          isCurrentRun
        });
        
        console.log(`💰 Wallet ${i + 1}: ${kp.publicKey.toBase58()}`);
        console.log(`   Balance: ${solBalance.toFixed(6)} SOL`);
        console.log(`   Status: ${isCurrentRun ? '✅ Current run (already gathered)' : '❌ OLD WALLET - NOT GATHERED!'}`);
        console.log(`   Private Key: ${allWallets[i].substring(0, 16)}...\n`);
      }
    } catch (e) {
      // Skip invalid keys
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total wallets checked: ${allWallets.length}`);
  console.log(`   Wallets with SOL: ${walletsWithSol.length}`);
  console.log(`   Total missing SOL: ${totalMissing.toFixed(6)} SOL`);
  
  const oldWallets = walletsWithSol.filter(w => !w.isCurrentRun);
  const oldWalletSol = oldWallets.reduce((sum, w) => sum + w.balance, 0);
  
  if (oldWallets.length > 0) {
    console.log(`\n⚠️  FOUND ${oldWallets.length} OLD WALLETS WITH SOL!`);
    console.log(`   Total in old wallets: ${oldWalletSol.toFixed(6)} SOL`);
    console.log(`   💰 Estimated value: $${(oldWalletSol * 120).toFixed(2)} (at $120/SOL)`);
    console.log(`\n💡 To recover:`);
    console.log(`   1. Update current-run.json with these wallet keys`);
    console.log(`   2. Run: npm run gather`);
    console.log(`\n   Or manually transfer from these wallets:`);
    oldWallets.forEach(w => {
      console.log(`   - ${w.address}: ${w.balance.toFixed(6)} SOL`);
    });
  } else {
    console.log(`\n✅ All wallets have been gathered!`);
  }
}

findMissingSol().catch(console.error);

