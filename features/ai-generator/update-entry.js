const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function update() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await client.connect();
  
  const siteUrl = 'stakeywagering.xyz';
  
  // Test data - socials and fake contract address
  const testData = {
    twitter: 'https://x.com/stakeywagering',
    telegram: 'https://t.me/stakeywagering',
    website: 'https://stakeywagering.xyz',
    docs: 'https://docs.stakeywagering.xyz',
    token_address: 'StAkEyWaGeR1ngT0k3nAddR3ssPuMpFuNz9876pump',
    contract_address: 'StAkEyWaGeR1ngT0k3nAddR3ssPuMpFuNz9876pump',
  };
  
  console.log('Updating', siteUrl, 'with test data...');
  
  await client.query(`
    UPDATE site_config SET 
      twitter = $1,
      telegram = $2,
      website = $3,
      docs = $4,
      token_address = $5,
      contract_address = $6,
      updated_at = NOW()
    WHERE site_url = $7
  `, [
    testData.twitter,
    testData.telegram,
    testData.website,
    testData.docs,
    testData.token_address,
    testData.contract_address,
    siteUrl
  ]);
  
  // Verify
  const result = await client.query('SELECT * FROM site_config WHERE site_url = $1', [siteUrl]);
  console.log('\n✅ Updated entry:');
  console.log(JSON.stringify(result.rows[0], null, 2));
  
  await client.end();
}

update().catch(console.error);
