/**
 * Quick test script to verify Railway database connection
 * Run: node test-db-connection.js
 */

require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not set in .env file');
  process.exit(1);
}

console.log('🔌 Testing Railway database connection...');
console.log('Host:', databaseUrl.match(/@([^:]+)/)?.[1] || 'unknown');

// Try with SSL first (Railway HTTP domains usually require SSL)
// Match Nodematrix connection config exactly
async function testConnection(useSSL) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: useSSL ? { rejectUnauthorized: false } : false, // Simple SSL config like Nodematrix
    // No timeout - use pg defaults
  });

  try {
    console.log(`\n🔌 Attempting connection ${useSSL ? 'WITH SSL' : 'WITHOUT SSL'}...`);
    await client.connect();
    console.log('✅ Connected successfully!');
    
    // Test query
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database query successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   PostgreSQL version:', result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1]);
    
    await client.end();
    return true;
  } catch (error) {
    console.error(`❌ Connection failed: ${error.message}`);
    console.error(`   Error code: ${error.code || 'unknown'}`);
    try {
      await client.end();
    } catch (e) {
      // Ignore cleanup errors
    }
    return false;
  }
}

async function main() {
  // Try with SSL first (Railway HTTP domains usually require SSL)
  const sslSuccess = await testConnection(true);
  
  if (!sslSuccess) {
    console.log('\n🔄 SSL connection failed, trying without SSL...');
    await testConnection(false);
  }
}

main().catch(console.error);

