import { Client } from 'pg';

const DATABASE_URL = 'postgresql://postgres:JeRSssJVOJdtZsiDaNbQfCmIXCKizOBY@maglev.proxy.rlwy.net:57301/railway';

async function fixDatabaseSchema() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: false, // TCP proxy doesn't support SSL
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check current columns
    const columnsResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'site_config'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📋 Current columns in site_config:');
    columnsResult.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });

    // Add missing columns
    console.log('\n🔧 Adding missing columns...');
    
    // Check if website_logo_image exists
    const hasWebsiteLogo = columnsResult.rows.some(r => r.column_name === 'website_logo_image');
    if (!hasWebsiteLogo) {
      await client.query(`
        ALTER TABLE site_config 
        ADD COLUMN IF NOT EXISTS website_logo_image TEXT;
      `);
      console.log('   ✅ Added website_logo_image column');
    } else {
      console.log('   ℹ️  website_logo_image already exists');
    }

    // Check if theme_name exists
    const hasThemeName = columnsResult.rows.some(r => r.column_name === 'theme_name');
    if (!hasThemeName) {
      await client.query(`
        ALTER TABLE site_config 
        ADD COLUMN IF NOT EXISTS theme_name VARCHAR(50);
      `);
      console.log('   ✅ Added theme_name column');
    } else {
      console.log('   ℹ️  theme_name already exists');
    }

    // Verify final schema
    const finalColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'site_config'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n✅ Final columns in site_config:');
    finalColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });

    console.log('\n✅ Database schema fixed!');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

fixDatabaseSchema().catch(console.error);



