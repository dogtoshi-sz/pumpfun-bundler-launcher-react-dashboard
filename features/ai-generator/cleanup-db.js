const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function cleanup() {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL,
    ssl: false 
  });

  await client.connect();
  console.log('Connected to database');
  
  // Drop the extra site_configs table I created by mistake
  console.log('Dropping accidental site_configs table...');
  await client.query('DROP TABLE IF EXISTS site_configs');
  console.log('Done!');
  
  // Verify tables
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('Remaining tables:', tables.rows.map(r => r.table_name).join(', '));
  
  await client.end();
}

cleanup().catch(console.error);
