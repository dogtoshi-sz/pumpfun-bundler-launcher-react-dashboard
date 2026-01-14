const { Client } = require('pg');

async function testAndUpdate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:JeRSssJVOJdtZsiDaNbQfCmIXCKizOBY@maglev.proxy.rlwy.net:57301/railway'
  });

  try {
    await client.connect();
    console.log('✅ PostgreSQL connected successfully!');

    // Check current entries
    const sites = await client.query('SELECT site_url, token_name, token_symbol FROM site_config');
    console.log('\n🌐 Current sites in database:');
    sites.rows.forEach(r => console.log('  -', r.site_url, ':', r.token_name, '(' + r.token_symbol + ')'));

    // Check if stakeywagering.xyz exists
    const exists = await client.query("SELECT * FROM site_config WHERE site_url = 'stakeywagering.xyz'");
    
    if (exists.rows.length > 0) {
      console.log('\n📝 stakeywagering.xyz exists, updating...');
      await client.query(`
        UPDATE site_config SET 
          token_name = 'Stakey Wagering',
          token_symbol = 'STAKE',
          description = 'Stake to Win - The premier wagering platform on Solana',
          color_scheme = 'gold',
          theme_name = 'gold',
          chain = 'solana',
          updated_at = NOW()
        WHERE site_url = 'stakeywagering.xyz'
      `);
      console.log('✅ Updated!');
    } else {
      console.log('\n📝 Creating stakeywagering.xyz entry...');
      await client.query(`
        INSERT INTO site_config (
          site_url, token_name, token_symbol, description, 
          color_scheme, theme_name, chain, template, created_at, updated_at
        )
        VALUES (
          'stakeywagering.xyz', 
          'Stakey Wagering', 
          'STAKE', 
          'Stake to Win - The premier wagering platform on Solana',
          'gold',
          'gold',
          'solana',
          'original',
          NOW(),
          NOW()
        )
      `);
      console.log('✅ Created!');
    }

    // Verify
    const verify = await client.query("SELECT * FROM site_config WHERE site_url = 'stakeywagering.xyz'");
    console.log('\n✅ Final entry:');
    console.log(JSON.stringify(verify.rows[0], null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testAndUpdate();
