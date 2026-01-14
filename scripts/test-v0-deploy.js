/**
 * v0 Website Generation → Vercel Deployment → Domain Connection Test
 * 
 * This script demonstrates the full pipeline:
 * 1. Generate a website using v0 API
 * 2. Deploy using v0's built-in deployment (handles Next.js build properly)
 * 3. Connect a domain via Vercel API
 */

require('dotenv').config();

// Check for required env vars
const V0_API_KEY = process.env.V0_API_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

if (!V0_API_KEY) {
  console.error('❌ V0_API_KEY not set in .env');
  process.exit(1);
}

if (!VERCEL_TOKEN || !VERCEL_TEAM_ID) {
  console.error('❌ VERCEL_TOKEN and VERCEL_TEAM_ID required in .env');
  process.exit(1);
}

// Import v0 SDK
const { v0 } = require('v0-sdk');

async function generateWebsite(tokenInfo) {
  console.log('\n🎨 Step 1: Generating website with v0...');
  console.log(`   Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
  
  const prompt = `
Create a modern, sleek cryptocurrency token landing page for "${tokenInfo.name}" ($${tokenInfo.symbol}).

Requirements:
- Dark theme with gradient accents
- Hero section with token name, symbol, and tagline
- Token description section
- Social links (Twitter, Telegram, Website)
- Contract address display with copy button
- Pump.fun buy button
- Responsive design
- Use Tailwind CSS
- Next.js App Router

Token Details:
- Name: ${tokenInfo.name}
- Symbol: ${tokenInfo.symbol}
- Description: ${tokenInfo.description}
- Contract Address: ${tokenInfo.contractAddress || 'TBD'}
- Website: ${tokenInfo.website || ''}
- Twitter: ${tokenInfo.twitter || ''}
- Telegram: ${tokenInfo.telegram || ''}

Make it look professional and eye-catching. Use a color scheme that matches the token's theme.
`;

  try {
    const chat = await v0.chats.create({
      message: prompt,
    });
    
    console.log(`   ✅ Website generated!`);
    console.log(`   📁 Files generated: ${chat.files?.length || 0}`);
    console.log(`   🔗 Demo URL: ${chat.demo || 'N/A'}`);
    console.log(`   Chat ID: ${chat.id}`);
    
    // List generated files
    const processedFiles = [];
    if (chat.files && chat.files.length > 0) {
      console.log('\n   Generated files:');
      chat.files.forEach((file, idx) => {
        let fileName;
        if (typeof file.meta === 'string') {
          fileName = file.meta;
        } else if (file.meta && typeof file.meta === 'object') {
          fileName = file.meta.file || file.meta.path || file.meta.name || `file-${idx}.tsx`;
        } else {
          fileName = `file-${idx}.tsx`;
        }
        
        const content = file.source || file.content || '';
        const lang = file.lang || 'typescript';
        console.log(`     - ${fileName} (${lang}, ${content.length} chars)`);
        processedFiles.push({ name: fileName, content, lang });
      });
    }
    
    return {
      success: true,
      files: processedFiles,
      demoUrl: chat.demo,
      chatId: chat.id,
    };
  } catch (error) {
    console.error(`   ❌ v0 generation failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function deployWithV0(chatId, projectName) {
  console.log('\n🚀 Step 2: Deploying with v0...');
  console.log(`   Chat ID: ${chatId}`);
  console.log(`   Project Name: ${projectName}`);
  
  try {
    // First get the latest version from the chat
    console.log('   Getting chat versions...');
    const versions = await v0.chats.findVersions(chatId);
    console.log(`   Found ${versions.length} versions`);
    
    if (!versions || versions.length === 0) {
      throw new Error('No versions found for chat');
    }
    
    // Get the latest version
    const latestVersion = versions[0];
    console.log(`   Latest version: ${latestVersion.id}`);
    
    // Create a v0 project from the chat
    console.log('   Creating v0 project...');
    const project = await v0.projects.create({
      chatId: chatId,
      name: projectName,
    });
    
    console.log(`   ✅ Project created: ${project.id}`);
    console.log(`   Project name: ${project.name}`);
    
    // Create deployment with chatId and versionId
    console.log('   Creating deployment...');
    const deployment = await v0.deployments.create({
      chatId: chatId,
      versionId: latestVersion.id,
    });
    
    console.log(`   ✅ Deployment created!`);
    console.log(`   Deployment ID: ${deployment.id}`);
    console.log(`   URL: ${deployment.url || 'Building...'}`);
    console.log(`   Status: ${deployment.status || deployment.readyState || 'BUILDING'}`);
    console.log(`   Full deployment response:`, JSON.stringify(deployment, null, 2));
    
    // Check if we have a vercel deployment URL
    if (deployment.vercelDeploymentUrl) {
      console.log(`   Vercel URL: ${deployment.vercelDeploymentUrl}`);
    }
    
    // Wait for deployment to be ready
    if (deployment.status !== 'READY' && deployment.readyState !== 'READY') {
      console.log('   Waiting for deployment to be ready...');
      let attempts = 0;
      while (attempts < 30) { // Wait up to 5 minutes
        await new Promise(r => setTimeout(r, 10000)); // 10 seconds
        attempts++;
        
        try {
          const status = await v0.deployments.getById(deployment.id);
          console.log(`   Status check ${attempts}: ${status.status || status.readyState || 'unknown'}`);
          
          if (status.status === 'READY' || status.readyState === 'READY') {
            console.log(`   ✅ Deployment ready!`);
            console.log(`   URL: ${status.url || status.vercelDeploymentUrl}`);
            return {
              success: true,
              projectId: project.id,
              deploymentId: deployment.id,
              deploymentUrl: status.url || status.vercelDeploymentUrl,
              v0ProjectId: project.id,
            };
          }
          
          if (status.status === 'ERROR' || status.readyState === 'ERROR') {
            console.log('   Deployment errors:', await v0.deployments.findErrors(deployment.id));
            throw new Error('Deployment failed');
          }
        } catch (e) {
          console.log(`   Status check error: ${e.message}`);
        }
      }
      console.log('   ⚠️ Deployment still building after 5 minutes');
    }
    
    return {
      success: true,
      projectId: project.id,
      deploymentId: deployment.id,
      deploymentUrl: deployment.url || deployment.vercelDeploymentUrl,
      v0ProjectId: project.id,
    };
  } catch (error) {
    console.error(`   ❌ v0 deployment failed:`, error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    return { success: false, error: error.message };
  }
}

async function connectDomain(projectId, domain) {
  console.log('\n🔗 Step 3: Connecting domain...');
  console.log(`   Domain: ${domain}`);
  console.log(`   Project ID: ${projectId}`);
  
  try {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/domains?teamId=${VERCEL_TEAM_ID}`,
      {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      }
    );
    
    const data = await res.json();
    
    if (!res.ok) {
      if (data.error?.code === 'domain_already_exists') {
        console.log(`   ⚠️  Domain already connected`);
        return { success: true, alreadyConnected: true };
      }
      throw new Error(data.error?.message || 'Failed to connect domain');
    }
    
    console.log(`   ✅ Domain connected!`);
    console.log(`   Verified: ${data.verified}`);
    
    return { success: true, verified: data.verified };
  } catch (error) {
    console.error(`   ❌ Domain connection failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   v0 → Vercel → Domain Pipeline Test');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Test token info (from .env or defaults)
  const tokenInfo = {
    name: process.env.TOKEN_NAME || 'Test Token',
    symbol: process.env.TOKEN_SYMBOL || 'TEST',
    description: process.env.DESCRIPTION || 'A test cryptocurrency token.',
    contractAddress: process.env.CUSTOM_TOKEN_ADDRESS || 'TBD',
    website: process.env.WEBSITE || '',
    twitter: process.env.TWITTER || '',
    telegram: process.env.TELEGRAM || '',
  };
  
  console.log('\n📋 Token Info:');
  console.log(`   Name: ${tokenInfo.name}`);
  console.log(`   Symbol: ${tokenInfo.symbol}`);
  console.log(`   Description: ${tokenInfo.description.substring(0, 50)}...`);
  
  // Step 1: Generate website with v0
  const genResult = await generateWebsite(tokenInfo);
  
  if (!genResult.success) {
    console.error('\n❌ Pipeline failed at Step 1');
    return;
  }
  
  // Step 2: Deploy with v0's built-in deployment
  // Sanitize project name
  const sanitizedSymbol = tokenInfo.symbol.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'token';
  const sanitizedName = tokenInfo.name.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 20) || 'project';
  const projectName = `${sanitizedName}-${sanitizedSymbol}-${Date.now().toString().slice(-6)}`;
  const deployResult = await deployWithV0(genResult.chatId, projectName);
  
  if (!deployResult.success) {
    console.error('\n❌ Pipeline failed at Step 2');
    return;
  }
  
  // Step 3: Connect domain (optional - only if WEBSITE_URL is set)
  const domain = process.env.WEBSITE_URL;
  if (domain && deployResult.projectId) {
    const domainResult = await connectDomain(deployResult.projectId, domain);
    if (!domainResult.success) {
      console.warn('\n⚠️  Domain connection failed, but project was created');
    }
  } else {
    console.log('\n⏭️  Step 3: Skipped (no WEBSITE_URL set)');
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   ✅ PIPELINE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n📊 Results:`);
  console.log(`   v0 Demo URL: ${genResult.demoUrl || 'N/A'}`);
  console.log(`   Files Generated: ${genResult.files?.length || 0}`);
  console.log(`   Vercel Project: ${deployResult.projectName}`);
  console.log(`   Project ID: ${deployResult.projectId}`);
  console.log(`   Deployment URL: ${deployResult.deploymentUrl || 'N/A'}`);
  console.log(`   Deployment Status: ${deployResult.status || 'N/A'}`);
  
  if (genResult.files && genResult.files.length > 0) {
    console.log('\n📁 Generated Files Preview:');
    genResult.files.slice(0, 3).forEach(file => {
      console.log(`\n   📄 ${file.name} (${file.lang}):`);
      console.log(`   ─────────────────────────────────`);
      const preview = file.content?.substring(0, 200) || '';
      console.log(`   ${preview.split('\n').join('\n   ')}...`);
    });
    
    // Save files to disk for review
    const fs = require('fs');
    const path = require('path');
    const outputDir = path.join(__dirname, '..', 'generated-websites', deployResult.projectName);
    
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      genResult.files.forEach(file => {
        const filePath = path.join(outputDir, file.name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content);
      });
      console.log(`\n💾 Files saved to: ${outputDir}`);
    } catch (err) {
      console.log(`\n⚠️  Could not save files: ${err.message}`);
    }
  }
  
  console.log('\n🔗 Next Steps:');
  console.log('   1. View the v0 demo at the URL above');
  console.log('   2. If satisfied, push the generated files to GitHub');
  console.log('   3. Connect the GitHub repo to the Vercel project');
  console.log('   4. Domain will be automatically connected');
}

// Run the test
runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
