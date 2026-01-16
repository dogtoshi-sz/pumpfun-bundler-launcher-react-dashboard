/**
 * PSD Logo API - Endpoints for PSD processing and logo generation
 * 
 * Endpoints:
 * - POST /api/psd/upload - Upload and process PSD file
 * - POST /api/logo/generate - Generate logo from assets
 * - GET /api/psd/assets - List extracted assets
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Determine project root - handles both local and Railway deployments
const getProjectRoot = () => {
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
  if (isRailway) {
    const parentSrc = path.join(__dirname, '..', 'src');
    if (fs.existsSync(parentSrc)) {
      return path.join(__dirname, '..');
    }
    return __dirname;
  }
  return path.join(__dirname, '..');
};
const PROJECT_ROOT = getProjectRoot();
const projectPath = (...segments) => path.join(PROJECT_ROOT, ...segments);

// Configure multer for PSD file uploads
const psdStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'psd-assets');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const name = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '');
    cb(null, `psd-${timestamp}-${name}`);
  }
});

const psdUpload = multer({
  storage: psdStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for PSD files
  fileFilter: function (req, file, cb) {
    // Accept PSD files
    if (file.mimetype === 'image/vnd.adobe.photoshop' || file.originalname.toLowerCase().endsWith('.psd')) {
      cb(null, true);
    } else {
      cb(new Error('Only PSD files are allowed'));
    }
  }
});

// Assets directory structure
const ASSETS_DIR = path.join(__dirname, '..', 'psd-assets');

/**
 * Upload and process PSD file
 * POST /api/psd/upload
 */
router.post('/upload', psdUpload.single('psd'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PSD file provided' });
    }

    const psdFilePath = req.file.path;
    const outputDir = path.join(ASSETS_DIR, path.basename(psdFilePath, path.extname(psdFilePath)));
    
    console.log(`[PSD API] Processing PSD: ${psdFilePath}`);
    
    // Process PSD file (requires PSD parsing library)
    // For now, return structure - you'll need to implement actual processing
    // const { processPSD, savePSDData } = require('../src/psd-processor.ts');
    // const psdData = await processPSD(psdFilePath, outputDir);
    // savePSDData(psdData, outputDir);
    
    // Placeholder response
    res.json({
      success: true,
      message: 'PSD file uploaded. Processing not yet implemented.',
      psdPath: psdFilePath,
      outputDir: outputDir,
      note: 'You need to install a PSD parsing library (e.g., ag-psd) and implement processing'
    });
    
  } catch (error) {
    console.error('[PSD API] Upload error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to process PSD file' });
  }
});

/**
 * Generate logo from assets
 * POST /api/logo/generate
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      tokenName,
      tokenSymbol,
      baseLogo,
      fontPath,
      fontFamily,
      fontSize = 48,
      textColor = '#FFFFFF',
      backgroundColor = '#000000',
      width = 512,
      height = 512,
      layout = 'centered',
      outputFormat = 'base64' // 'base64' or 'file'
    } = req.body;

    if (!tokenName && !tokenSymbol) {
      return res.status(400).json({ success: false, error: 'Token name or symbol required' });
    }

    console.log(`[Logo API] Generating logo for: ${tokenName || tokenSymbol}`);
    
    // Use simple logo generator (works with images and fonts, no PSD parsing needed)
    try {
      const { generateSimpleLogoAsBase64, generateAndSaveSimpleLogo } = require(projectPath('src', 'simple-logo-generator.ts'));
      
      const options = {
        tokenName,
        tokenSymbol,
        baseLogoPath: baseLogo,
        fontPath,
        fontFamily,
        fontSize,
        textColor,
        backgroundColor,
        width,
        height,
        textPosition: layout === 'horizontal' ? 'center' : layout
      };
      
      if (outputFormat === 'base64') {
        const base64 = await generateSimpleLogoAsBase64(options);
        res.json({ success: true, logo: base64 });
      } else {
        // Save to image/createdlogos directory
        const logosDir = path.join(__dirname, '..', 'image', 'createdlogos');
        if (!fs.existsSync(logosDir)) {
          fs.mkdirSync(logosDir, { recursive: true });
        }
        const imageFilename = `logo-${Date.now()}.png`;
        const outputPath = path.join(logosDir, imageFilename);
        await generateAndSaveSimpleLogo(options, outputPath);
        
        res.json({ 
          success: true, 
          logoPath: outputPath, 
          logoUrl: `/image/createdlogos/${imageFilename}`,
          message: 'Logo generated successfully'
        });
      }
    } catch (error) {
      console.error('[Logo API] Generation error:', error);
      if (error.message && error.message.includes('Canvas package not installed')) {
        res.status(500).json({ 
          success: false, 
          error: 'Canvas package not installed',
          instructions: 'Run: npm install canvas (may require additional setup on Windows)'
        });
      } else {
        res.status(500).json({ success: false, error: error.message || 'Failed to generate logo' });
      }
    }
    
  } catch (error) {
    console.error('[Logo API] Generate error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate logo' });
  }
});

/**
 * List available alphabet logos
 * GET /api/logo/alphabet
 */
router.get('/alphabet', (req, res) => {
  try {
    const { listAlphabetLogos } = require(projectPath('src', 'launch-logo-generator.ts'));
    const logos = listAlphabetLogos();
    
    res.json({
      success: true,
      logos: logos,
      count: logos.length,
      note: 'Use these letters in alphabetLogo parameter when generating logos'
    });
  } catch (error) {
    console.error('[Logo API] List alphabet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list alphabet logos' });
  }
});

/**
 * Generate all launch logos (token, website, twitter)
 * POST /api/logo/generate-launch
 */
router.post('/generate-launch', async (req, res) => {
  try {
    const {
      tokenName,
      tokenSymbol,
      baseLogo,
      alphabetLogo,
      fontPath,
      fontFamily,
      primaryColor,
      secondaryColor,
      backgroundColor
    } = req.body;

    if (!tokenName && !tokenSymbol) {
      return res.status(400).json({ success: false, error: 'Token name or symbol required' });
    }

    console.log(`[Logo API] Generating launch logos for: ${tokenName || tokenSymbol}`);
    
    try {
      const { generateLaunchLogos } = require(projectPath('src', 'launch-logo-generator.ts'));
      
      const logos = await generateLaunchLogos({
        tokenName: tokenName || '',
        tokenSymbol: tokenSymbol || '',
        baseLogoPath: baseLogo,
        alphabetLogo: alphabetLogo,
        fontPath: fontPath,
        fontFamily: fontFamily,
        primaryColor: primaryColor,
        secondaryColor: secondaryColor,
        backgroundColor: backgroundColor
      });
      
      res.json({
        success: true,
        logos: {
          tokenLogo: logos.tokenLogo,
          websiteLogo: logos.websiteLogo,
          twitterBanner: logos.twitterBanner
        },
        urls: {
          tokenLogo: `/image/createdlogos/${path.basename(logos.tokenLogo)}`,
          websiteLogo: `/image/createdlogos/${path.basename(logos.websiteLogo)}`,
          twitterBanner: `/image/createdlogos/${path.basename(logos.twitterBanner)}`
        },
        message: 'All launch logos generated successfully'
      });
    } catch (error) {
      console.error('[Logo API] Generation error:', error);
      if (error.message && error.message.includes('Canvas package not installed')) {
        res.status(500).json({ 
          success: false, 
          error: 'Canvas package not installed',
          instructions: 'Run: npm install canvas'
        });
      } else {
        res.status(500).json({ success: false, error: error.message || 'Failed to generate logos' });
      }
    }
    
  } catch (error) {
    console.error('[Logo API] Generate launch error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate launch logos' });
  }
});

/**
 * List extracted assets
 * GET /api/psd/assets
 */
router.get('/assets', (req, res) => {
  try {
    const assets = {
      psdFiles: [],
      logos: [],
      fonts: []
    };

    if (fs.existsSync(ASSETS_DIR)) {
      // List PSD files
      const psdFiles = fs.readdirSync(ASSETS_DIR).filter(f => f.toLowerCase().endsWith('.psd'));
      assets.psdFiles = psdFiles.map(f => ({
        name: f,
        path: path.join(ASSETS_DIR, f),
        size: fs.statSync(path.join(ASSETS_DIR, f)).size
      }));

      // List extracted logos
      const logosDir = path.join(ASSETS_DIR, 'logos');
      if (fs.existsSync(logosDir)) {
        assets.logos = fs.readdirSync(logosDir)
          .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
          .map(f => ({
            name: f,
            path: path.join(logosDir, f),
            url: `/psd-assets/logos/${f}`
          }));
      }

      // List extracted fonts
      const fontsDir = path.join(ASSETS_DIR, 'fonts');
      if (fs.existsSync(fontsDir)) {
        assets.fonts = fs.readdirSync(fontsDir)
          .filter(f => f.match(/\.(ttf|otf|woff|woff2)$/i))
          .map(f => ({
            name: f,
            path: path.join(fontsDir, f),
            url: `/psd-assets/fonts/${f}`
          }));
      }
    }

    res.json({ success: true, assets });
  } catch (error) {
    console.error('[PSD API] List assets error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list assets' });
  }
});

module.exports = router;
