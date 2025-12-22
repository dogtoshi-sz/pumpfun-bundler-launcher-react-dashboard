require('dotenv').config();

console.log('=== Pumpfun Bundler Setup Check ===\n');

const requiredVars = [
  'PRIVATE_KEY',
  'RPC_ENDPOINT',
  'RPC_WEBSOCKET_ENDPOINT',
  'TOKEN_NAME',
  'TOKEN_SYMBOL',
  'SWAP_AMOUNT',
  'DISTRIBUTION_WALLETNUM'
];

let allSet = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (!value || value === '') {
    console.log(`❌ ${varName}: NOT SET`);
    allSet = false;
  } else {
    if (varName === 'PRIVATE_KEY') {
      console.log(`✅ ${varName}: Set (${value.substring(0, 10)}...)`);
    } else {
      console.log(`✅ ${varName}: Set`);
    }
  }
});

console.log('\n=== Configuration Summary ===');
console.log(`RPC Endpoint: ${process.env.RPC_ENDPOINT ? 'Configured' : 'Missing'}`);
console.log(`Token Name: ${process.env.TOKEN_NAME || 'Not set'}`);
console.log(`Swap Amount: ${process.env.SWAP_AMOUNT || 'Not set'} SOL`);
console.log(`Wallets: ${process.env.DISTRIBUTION_WALLETNUM || 'Not set'}`);

if (!allSet) {
  console.log('\n⚠️  Missing required configuration. Please update .env file.');
  process.exit(1);
} else {
  console.log('\n✅ All required variables are set! Ready to run.');
}

