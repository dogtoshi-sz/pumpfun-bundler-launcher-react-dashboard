/**
 * Cancel pending Dune executions
 * 
 * On Dune free plan, only one query can run at a time.
 * This script cancels any pending executions.
 * 
 * Reference: https://docs.dune.com/api-reference/executions/endpoint/cancel-execution
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

const DUNE_API_KEY = process.env.DUNE_API_KEY;
const QUERY_ID = '6499319'; // Your hourly volume query

if (!DUNE_API_KEY) {
  console.error('❌ DUNE_API_KEY not found in .env');
  process.exit(1);
}

async function main() {
  console.log('🔍 Checking Dune query status...\n');

  // First, try to get the latest execution status
  try {
    const statusRes = await fetch(`https://api.dune.com/api/v1/query/${QUERY_ID}/results`, {
      headers: { 'x-dune-api-key': DUNE_API_KEY }
    });

    if (statusRes.ok) {
      const data = await statusRes.json();
      console.log('📊 Latest execution info:');
      console.log(`   State: ${data.state || 'unknown'}`);
      console.log(`   Execution ID: ${data.execution_id || 'N/A'}`);
      console.log(`   Submitted at: ${data.submitted_at || 'N/A'}`);
      console.log(`   Ended at: ${data.execution_ended_at || 'N/A (still running?)'}`);
      
      // Check if there's a pending execution
      if (data.state && !['QUERY_STATE_COMPLETED', 'QUERY_STATE_FAILED', 'QUERY_STATE_CANCELLED'].includes(data.state)) {
        console.log(`\n⚠️ Query is still in state: ${data.state}`);
        
        if (data.execution_id) {
          console.log(`\n🛑 Attempting to cancel execution ${data.execution_id}...`);
          
          const cancelRes = await fetch(`https://api.dune.com/api/v1/execution/${data.execution_id}/cancel`, {
            method: 'POST',
            headers: { 'x-dune-api-key': DUNE_API_KEY }
          });
          
          if (cancelRes.ok) {
            const cancelData = await cancelRes.json();
            console.log(`✅ Cancel result: ${JSON.stringify(cancelData)}`);
          } else {
            console.log(`❌ Cancel failed: ${cancelRes.status} ${cancelRes.statusText}`);
            const errorText = await cancelRes.text();
            console.log(`   Error: ${errorText}`);
          }
        }
      } else {
        console.log('\n✅ No pending execution found. Query is ready!');
      }
    } else {
      console.log(`⚠️ Could not fetch query status: ${statusRes.status}`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  // Now try to execute a fresh query
  console.log('\n🚀 Starting fresh execution...');
  
  try {
    const execRes = await fetch(`https://api.dune.com/api/v1/query/${QUERY_ID}/execute`, {
      method: 'POST',
      headers: { 
        'x-dune-api-key': DUNE_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (execRes.ok) {
      const execData = await execRes.json();
      console.log(`✅ Execution started!`);
      console.log(`   Execution ID: ${execData.execution_id}`);
      console.log(`   State: ${execData.state}`);
      
      // Poll for completion
      console.log('\n⏳ Waiting for execution to complete...');
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds max
      
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        
        const statusRes = await fetch(`https://api.dune.com/api/v1/execution/${execData.execution_id}/status`, {
          headers: { 'x-dune-api-key': DUNE_API_KEY }
        });
        
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          console.log(`   [${attempts + 1}/${maxAttempts}] State: ${statusData.state}`);
          
          if (statusData.state === 'QUERY_STATE_COMPLETED') {
            console.log('\n✅ Query execution completed successfully!');
            console.log('   Your Dune data should now be fresh.');
            console.log('   Click the refresh button in Launch Analytics to see updated data.');
            break;
          } else if (statusData.state === 'QUERY_STATE_FAILED') {
            console.log('\n❌ Query execution failed!');
            break;
          } else if (statusData.state === 'QUERY_STATE_CANCELLED') {
            console.log('\n⚠️ Query was cancelled');
            break;
          }
        }
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        console.log('\n⚠️ Execution is taking too long. It might complete in the background.');
        console.log(`   Execution ID: ${execData.execution_id}`);
      }
    } else {
      const errorText = await execRes.text();
      console.log(`❌ Failed to start execution: ${execRes.status}`);
      console.log(`   Error: ${errorText}`);
      
      if (errorText.includes('already')) {
        console.log('\n💡 Tip: A query might already be running. Wait a minute and try again.');
      }
    }
  } catch (error) {
    console.error('❌ Error starting execution:', error.message);
  }
}

main();
