const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function check() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await client.connect();
  
  const siteUrl = process.argv[2] || 'stakeywagering.xyz';
  const result = await client.query('SELECT * FROM site_config WHERE site_url = $1', [siteUrl]);
  
  if (result.rows.length === 0) {
    console.log('No entry found for:', siteUrl);
  } else {
    console.log('Full entry for', siteUrl + ':');
    console.log(JSON.stringify(result.rows[0], null, 2));
  }
  
  await client.end();
}
check();
