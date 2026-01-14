const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:JeRSssJVOJdtZsiDaNbQfCmIXCKizOBY@maglev.proxy.rlwy.net:57301/railway'
});

async function main() {
  try {
    const result = await pool.query(
      "SELECT * FROM site_config WHERE site_url = $1",
      ['mitsuiai.xyz']
    );
    
    if (result.rows.length === 0) {
      console.log('No config found for mitsuiai.xyz');
    } else {
      console.log('Config for mitsuiai.xyz:');
      console.log(JSON.stringify(result.rows[0], null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

main();
