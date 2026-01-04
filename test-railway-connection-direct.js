/**
 * Test Railway database connection directly
 * This will help us see if the database is actually reachable
 */

require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not set in .env file');
  process.exit(1);
}

console.log('🔌 Testing Railway database connection...');
console.log('Connection string:', databaseUrl.replace(/:[^:@]+@/, ':****@'));

// Extract hostname
const hostMatch = databaseUrl.match(/@([^:]+)/);
const hostname = hostMatch ? hostMatch[1] : 'unknown';
console.log('Hostname:', hostname);

// Try connection with simple config (like Nodematrix)
async function testConnection() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway') || databaseUrl.includes('rlwy.net')
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    console.log('\n🔌 Attempting connection...');
    console.log('SSL:', databaseUrl.includes('railway') ? 'enabled' : 'disabled');
    
    const startTime = Date.now();
    await client.connect();
    const connectTime = Date.now() - startTime;
    
    console.log(`✅ Connected successfully! (${connectTime}ms)`);
    
    // Test query
    const queryStart = Date.now();
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    const queryTime = Date.now() - queryStart;
    
    console.log('✅ Database query successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   PostgreSQL version:', result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1]);
    console.log(`   Query time: ${queryTime}ms`);
    
    // Check if site_config table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'site_config'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ site_config table exists');
    } else {
      console.log('⚠️  site_config table does NOT exist (will be created on first update)');
    }
    
    await client.end();
    console.log('\n🎉 Connection test successful!');
    return true;
  } catch (error) {
    console.error(`\n❌ Connection failed: ${error.message}`);
    console.error(`   Error code: ${error.code || 'unknown'}`);
    
    if (error.code === 'ETIMEDOUT') {
      console.error('\n💡 Connection timeout - possible causes:');
      console.error('   1. Railway database not allowing external connections');
      console.error('   2. Firewall/network blocking port 5432');
      console.error('   3. Public Networking not enabled in Railway');
      console.error('   4. Need to use Railway CLI tunnel');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Connection refused - possible causes:');
      console.error('   1. Database is not running');
      console.error('   2. Wrong hostname/port');
      console.error('   3. Railway database paused');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 Host not found - check your DATABASE_URL hostname');
    }
    
    try {
      await client.end();
    } catch (e) {
      // Ignore cleanup errors
    }
    return false;
  }
}

testConnection().catch(console.error);



