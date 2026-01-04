// Quick script to add missing columns
// Run: node fix-db-quick.js

const { Client } = require('pg');

const DATABASE_URL = 'postgresql://postgres:JeRSssJVOJdtZsiDaNbQfCmIXCKizOBY@maglev.proxy.rlwy.net:57301/railway';

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✅ Connected');

    console.log('\nAdding missing columns...');
    
    await client.query(`
      ALTER TABLE site_config 
      ADD COLUMN IF NOT EXISTS website_logo_image TEXT;
    `);
    console.log('✅ Added website_logo_image');

    await client.query(`
      ALTER TABLE site_config 
      ADD COLUMN IF NOT EXISTS theme_name VARCHAR(50);
    `);
    console.log('✅ Added theme_name');

    console.log('\n✅ Database schema fixed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();



