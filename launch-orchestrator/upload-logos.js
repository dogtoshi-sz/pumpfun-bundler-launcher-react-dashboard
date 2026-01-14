const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

async function uploadToVercelBlob(buffer, filename) {
  const response = await fetch('https://blob.vercel-storage.com/' + filename, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + BLOB_TOKEN,
      'Content-Type': 'image/png',
      'x-api-version': '7',
    },
    body: buffer,
  });
  if (!response.ok) throw new Error('Upload failed: ' + response.status);
  const result = await response.json();
  console.log('Uploaded:', result.url);
  return result.url;
}

async function main() {
  const siteUrl = process.argv[2] || 'stakeywagering.xyz';
  const generatedDir = path.join(__dirname, 'assets', 'generated');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.png'));
  
  const tokenLogo = files.filter(f => f.startsWith('token-logo')).sort().pop();
  const websiteLogo = files.filter(f => f.startsWith('website-logo')).sort().pop();

  console.log('Uploading logos for:', siteUrl);
  
  const ts = Date.now();
  const prefix = siteUrl.replace(/\./g, '-');

  const tokenLogoUrl = await uploadToVercelBlob(
    fs.readFileSync(path.join(generatedDir, tokenLogo)),
    prefix + '-token-' + ts + '.png'
  );
  
  const websiteLogoUrl = await uploadToVercelBlob(
    fs.readFileSync(path.join(generatedDir, websiteLogo)),
    prefix + '-website-' + ts + '.png'
  );

  // Update existing site_config table
  const client = new Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  
  await client.query(
    'UPDATE site_config SET token_image_url = $1, logo_url = $2, website_logo_image = $2, updated_at = NOW() WHERE site_url = $3',
    [tokenLogoUrl, websiteLogoUrl, siteUrl]
  );
  
  const verify = await client.query('SELECT site_url, token_name, token_image_url, logo_url FROM site_config WHERE site_url = $1', [siteUrl]);
  console.log('Updated:', JSON.stringify(verify.rows[0], null, 2));
  
  await client.end();
}

main().catch(console.error);
