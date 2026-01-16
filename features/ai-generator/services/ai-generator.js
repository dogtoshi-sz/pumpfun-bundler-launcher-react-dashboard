/**
 * AI Content Generator
 * 
 * Generates token names, descriptions, taglines, and branding suggestions
 * using OpenAI GPT-4 or falls back to templates.
 */

const OpenAI = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Color schemes available for tokens
const COLOR_SCHEMES = [
  { id: 'cyber', name: 'Cyber Blue', primary: '#00f0ff', secondary: '#0066ff', bg: '#0a0a1a' },
  { id: 'neon', name: 'Neon Green', primary: '#00ff88', secondary: '#00cc66', bg: '#0a1a0a' },
  { id: 'sunset', name: 'Sunset Orange', primary: '#ff6b35', secondary: '#ff4444', bg: '#1a0a0a' },
  { id: 'royal', name: 'Royal Purple', primary: '#9945FF', secondary: '#7c3aed', bg: '#0f0a1a' },
  { id: 'gold', name: 'Gold', primary: '#ffd700', secondary: '#ffb700', bg: '#1a1500' },
  { id: 'pink', name: 'Hot Pink', primary: '#ff00ff', secondary: '#ff69b4', bg: '#1a0a1a' },
  { id: 'ice', name: 'Ice White', primary: '#e0f7ff', secondary: '#a0d8ef', bg: '#0a1015' },
  { id: 'fire', name: 'Fire Red', primary: '#ff4500', secondary: '#ff6347', bg: '#1a0500' },
  { id: 'matrix', name: 'Matrix Green', primary: '#00ff00', secondary: '#32cd32', bg: '#000a00' },
];

// Theme mappings for smart suggestions
const THEME_KEYWORDS = {
  wagering: ['casino', 'stake', 'bet', 'gamble', 'luck', 'win', 'jackpot', 'dice', 'poker', 'roulette'],
  ai: ['artificial', 'intelligence', 'neural', 'machine', 'learning', 'bot', 'agent', 'auto', 'smart'],
  dog: ['doge', 'shiba', 'puppy', 'woof', 'bark', 'paw', 'bone', 'fetch', 'good boy'],
  cat: ['kitty', 'meow', 'whiskers', 'purr', 'feline', 'paw', 'neko'],
  frog: ['pepe', 'kek', 'ribbit', 'pond', 'leap', 'green'],
  space: ['moon', 'mars', 'rocket', 'galaxy', 'cosmic', 'star', 'orbit', 'asteroid'],
  money: ['cash', 'rich', 'wealth', 'dollar', 'profit', 'bank', 'gold', 'treasure'],
  gaming: ['game', 'play', 'level', 'quest', 'hero', 'rpg', 'arcade', 'pixel'],
  defi: ['yield', 'farm', 'swap', 'pool', 'liquidity', 'vault', 'protocol'],
  meme: ['wojak', 'chad', 'based', 'cope', 'seethe', 'ngmi', 'wagmi', 'lfg'],
};

// Template-based fallback generator
function generateFromTemplate(prompt, theme) {
  const themes = {
    wagering: {
      names: ['LuckyStake', 'BetWin', 'JackpotJoe', 'DiceRoll', 'GoldenBet', 'StakeMaster', 'CasinoKing'],
      tickers: ['LUCK', 'STAKE', 'BET', 'WIN', 'JACK', 'DICE', 'GOLD'],
      taglines: ['Your luck, your stake, your destiny', 'Roll the dice, win the prize', 'Where winners are made'],
      colors: ['gold', 'fire', 'royal'],
    },
    ai: {
      names: ['NeuralNet', 'AIMatrix', 'BrainBot', 'SmartAgent', 'DeepMind', 'AutoGenius', 'SynapseAI'],
      tickers: ['NEURAL', 'BRAIN', 'AGENT', 'SYNAPSE', 'AUTO', 'MIND'],
      taglines: ['Intelligence evolved', 'The future is automated', 'Smarter than the rest'],
      colors: ['cyber', 'matrix', 'ice'],
    },
    dog: {
      names: ['SuperShiba', 'DogeKing', 'BarkCoin', 'PuppyPump', 'WoofWorld', 'GoodBoy', 'FluffyDoge'],
      tickers: ['SHIB', 'WOOF', 'BARK', 'PAW', 'DOGE', 'FLUFF'],
      taglines: ['Much wow, very gains', 'To the moon and beyond', 'Who let the dogs out?'],
      colors: ['sunset', 'gold', 'neon'],
    },
    cat: {
      names: ['MeowMaster', 'KittyCoin', 'PurrPump', 'WhiskerWin', 'FelineFi', 'NekoCash'],
      tickers: ['MEOW', 'KITTY', 'PURR', 'NEKO', 'WHISKER'],
      taglines: ['9 lives, infinite gains', 'Purrfectly profitable', 'The cat is out of the bag'],
      colors: ['pink', 'royal', 'sunset'],
    },
    frog: {
      names: ['PepePump', 'FrogKing', 'KekCoin', 'RibbitRich', 'PondProfit', 'LeapFrog'],
      tickers: ['PEPE', 'KEK', 'FROG', 'RIBBIT', 'POND'],
      taglines: ['Feels good man', 'Hop to it', 'Green is the new gold'],
      colors: ['neon', 'matrix', 'ice'],
    },
    space: {
      names: ['MoonShot', 'CosmicCash', 'RocketRise', 'GalaxyGains', 'StarStake', 'OrbitOne'],
      tickers: ['MOON', 'ROCKET', 'STAR', 'COSMIC', 'ORBIT'],
      taglines: ['To the moon!', 'Beyond the stars', 'Launch your portfolio'],
      colors: ['royal', 'cyber', 'ice'],
    },
    meme: {
      names: ['BasedBro', 'ChadCoin', 'WagmiWorld', 'LFGLabs', 'DiamondHands', 'DegenDAO'],
      tickers: ['BASED', 'CHAD', 'WAGMI', 'LFG', 'DEGEN'],
      taglines: ['We are all gonna make it', 'Stay based, stay winning', 'LFG to the moon'],
      colors: ['neon', 'fire', 'pink'],
    },
    default: {
      names: ['MegaToken', 'SuperCoin', 'UltraFi', 'PowerPump', 'AlphaGains'],
      tickers: ['MEGA', 'SUPER', 'ULTRA', 'ALPHA', 'POWER'],
      taglines: ['The next big thing', 'Join the revolution', 'Built different'],
      colors: ['cyber', 'neon', 'royal'],
    },
  };

  // Detect theme from prompt
  let detectedTheme = 'default';
  const promptLower = prompt.toLowerCase();
  
  for (const [themeName, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some(kw => promptLower.includes(kw)) || promptLower.includes(themeName)) {
      detectedTheme = themeName;
      break;
    }
  }

  // Also check if user specified a theme directly
  if (theme && themes[theme]) {
    detectedTheme = theme;
  }

  const themeData = themes[detectedTheme] || themes.default;
  
  // Random selection
  const name = themeData.names[Math.floor(Math.random() * themeData.names.length)];
  const ticker = themeData.tickers[Math.floor(Math.random() * themeData.tickers.length)];
  const tagline = themeData.taglines[Math.floor(Math.random() * themeData.taglines.length)];
  const colorScheme = themeData.colors[Math.floor(Math.random() * themeData.colors.length)];

  // Generate description based on theme
  const descriptions = {
    wagering: `${name} is the ultimate wagering platform on Solana. Stake your tokens, roll the dice, and win big. Fair, transparent, and built for degens who love the thrill.`,
    ai: `${name} leverages cutting-edge artificial intelligence to revolutionize DeFi. Smart contracts powered by machine learning for optimal gains.`,
    dog: `${name} - the goodest boy in crypto! Join the pack and bark your way to the moon. Community-driven, meme-powered, gains guaranteed.`,
    cat: `${name} brings feline finesse to DeFi. Nine lives means nine chances to moon. Purrfect tokenomics for the sophisticated investor.`,
    frog: `${name} - feels good to be early! Hop aboard the lily pad of gains. The rarest Pepe in the pond.`,
    space: `${name} is your launchpad to the cosmos. Blast off with revolutionary tokenomics designed for interstellar gains.`,
    meme: `${name} - for the true degens. Diamond hands only. We're all gonna make it, anon. LFG!`,
    default: `${name} is a revolutionary Solana token built for the next generation of crypto natives. Fast, fair, and community-driven.`,
  };

  return {
    success: true,
    source: 'template',
    theme: detectedTheme,
    data: {
      name,
      ticker,
      tagline,
      description: descriptions[detectedTheme] || descriptions.default,
      colorScheme,
      aboutPage: `Welcome to ${name}!\n\n${descriptions[detectedTheme] || descriptions.default}\n\nJoin our community and be part of the journey. Early supporters will be rewarded.\n\n🚀 Fair launch on pump.fun\n💎 No presale, no team allocation\n🔥 100% community owned`,
    },
  };
}

class AIGenerator {
  constructor() {
    this.openai = null;
    this.useOpenAI = false;

    // Initialize OpenAI if key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      this.useOpenAI = true;
      console.log('[AI Generator] ✅ OpenAI initialized');
    } else {
      console.log('[AI Generator] ⚠️ No OPENAI_API_KEY found, using template fallback');
    }
  }

  /**
   * Generate token content from a prompt
   * @param {string} prompt - Natural language description (e.g., "wagering website for stakey")
   * @param {object} options - Optional overrides
   * @returns {object} Generated content
   */
  async generateContent(prompt, options = {}) {
    const { forceTemplate = false, theme = null, existingName = null } = options;

    // Use template if forced or no OpenAI
    if (forceTemplate || !this.useOpenAI) {
      return generateFromTemplate(prompt, theme);
    }

    try {
      const systemPrompt = `You are a creative crypto token branding expert. Generate unique, catchy, and memorable token branding based on user prompts.

Available color schemes: cyber (blue), neon (green), sunset (orange), royal (purple), gold, pink, ice (white), fire (red), matrix (green).

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{
  "name": "Token Name (2-3 words max, catchy and memorable)",
  "ticker": "TICKER (3-6 uppercase letters)",
  "tagline": "Short catchy tagline (5-10 words)",
  "description": "Pump.fun description (1-2 sentences, exciting and FOMO-inducing)",
  "colorScheme": "one of: cyber, neon, sunset, royal, gold, pink, ice, fire, matrix",
  "aboutPage": "Longer description for website (2-3 paragraphs with emojis)"
}`;

      let userPrompt = `Create branding for: "${prompt}"`;
      if (existingName) {
        userPrompt += `\n\nUse this name: "${existingName}"`;
      }
      if (theme) {
        userPrompt += `\nTheme preference: ${theme}`;
      }

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1000,
      });

      const content = response.choices[0].message.content.trim();
      
      // Parse JSON response
      let data;
      try {
        // Remove any markdown code blocks if present
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        data = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('[AI Generator] Failed to parse OpenAI response:', content);
        return generateFromTemplate(prompt, theme);
      }

      // Validate required fields
      if (!data.name || !data.ticker || !data.description) {
        console.error('[AI Generator] Missing required fields in response');
        return generateFromTemplate(prompt, theme);
      }

      // Normalize color scheme
      const validColors = ['cyber', 'neon', 'sunset', 'royal', 'gold', 'pink', 'ice', 'fire', 'matrix'];
      if (!validColors.includes(data.colorScheme)) {
        data.colorScheme = 'cyber';
      }

      return {
        success: true,
        source: 'openai',
        theme: theme || 'auto',
        data,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      console.error('[AI Generator] OpenAI error:', error.message);
      
      // Check for specific errors
      if (error.code === 'insufficient_quota') {
        console.error('[AI Generator] OpenAI quota exceeded!');
      }
      
      // Fallback to template
      return generateFromTemplate(prompt, theme);
    }
  }

  /**
   * Generate multiple variations
   */
  async generateVariations(prompt, count = 3, options = {}) {
    const variations = [];
    
    for (let i = 0; i < count; i++) {
      const result = await this.generateContent(prompt, {
        ...options,
        // Slightly modify prompt for variation
        forceTemplate: options.forceTemplate || (i > 0 && !this.useOpenAI),
      });
      
      if (result.success) {
        variations.push(result.data);
      }
    }

    return {
      success: variations.length > 0,
      variations,
      source: this.useOpenAI ? 'openai' : 'template',
    };
  }

  /**
   * Get available color schemes
   */
  getColorSchemes() {
    return COLOR_SCHEMES;
  }

  /**
   * Get theme keywords for suggestions
   */
  getThemeKeywords() {
    return THEME_KEYWORDS;
  }

  /**
   * Check if OpenAI is available
   */
  isOpenAIAvailable() {
    return this.useOpenAI;
  }
}

// Singleton instance
const aiGenerator = new AIGenerator();

// Branding integration
let BrandingGenerator = null;
try {
  BrandingGenerator = require('./branding-generator');
  console.log('[AI Generator] ✅ BrandingGenerator loaded successfully');
} catch (e) {
  console.log('[AI Generator] ⚠️ Branding generator not available:', e.message);
}

/**
 * Upload a buffer to Vercel Blob
 */
async function uploadToVercelBlob(buffer, filename) {
  const blobToken = process.env.VERCEL_BLOB_TOKEN;
  if (!blobToken) {
    throw new Error('VERCEL_BLOB_TOKEN not configured');
  }

  const response = await fetch('https://blob.vercel-storage.com/' + filename, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + blobToken,
      'Content-Type': 'image/png',
      'x-api-version': '7',
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.url;
}

/**
 * Generate image using Gemini AI (Nano Banana)
 * Note: Requires PAID billing on Google Cloud - free tier has 0 quota for image generation
 */
async function generateGeminiImage(prompt, style = 'meme') {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Build enhanced prompt based on style
  let enhancedPrompt = prompt;
  if (style === 'meme') {
    enhancedPrompt = `Create a high-quality, vibrant meme token logo/mascot for crypto: ${prompt}. 
      Style: Fun, eye-catching, suitable for a crypto token. 
      The image should be iconic, memorable, and work well as a small token icon.
      Clean, bold design with good contrast. No text in the image.`;
  } else if (style === 'professional') {
    enhancedPrompt = `Create a professional, clean logo for a crypto project: ${prompt}. 
      Style: Modern, sleek, trustworthy. Suitable for a serious DeFi or utility token.
      The image should work well as a small icon. No text in the image.`;
  }

  console.log(`[Gemini AI] Generating image for: ${prompt.slice(0, 50)}...`);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image', // Nano Banana Pro - best image generation model
      contents: enhancedPrompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
        }
      }
    });

    // Extract image from response
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          console.log(`[Gemini AI] ✅ Image generated successfully`);
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
    }

    throw new Error('No image in Gemini response');
  } catch (error) {
    // Check for quota/billing errors
    if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || 
        error.message?.includes('quota') || error.status === 429) {
      console.error(`[Gemini AI] ⚠️ QUOTA ERROR: Image generation requires PAID billing. Free tier has 0 quota for image models.`);
      console.error(`[Gemini AI] To fix: Enable billing at https://console.cloud.google.com/billing`);
      throw new Error('QUOTA_EXCEEDED: Gemini image generation requires paid billing (free tier has 0 quota). Falling back to static logos.');
    }
    throw error;
  }
}

/**
 * Generate content with optional branding images
 */
async function generateContentWithBranding(prompt, options = {}) {
  const { generateImages = false, uploadImages = false, useGeminiAI = true } = options;

  console.log(`[AI Generator] generateContentWithBranding called with generateImages=${generateImages}, uploadImages=${uploadImages}, useGeminiAI=${useGeminiAI}`);

  // First, generate the text content
  const contentResult = await aiGenerator.generateContent(prompt, options);
  
  if (!contentResult.success) {
    console.log('[AI Generator] Content generation failed:', contentResult);
    return contentResult;
  }

  const result = { ...contentResult };

  console.log(`[AI Generator] Content generated: ${contentResult.data.name} (${contentResult.data.ticker})`);
  console.log(`[AI Generator] BrandingGenerator available: ${!!BrandingGenerator}`);
  console.log(`[AI Generator] GEMINI_API_KEY set: ${!!process.env.GEMINI_API_KEY}`);
  console.log(`[AI Generator] VERCEL_BLOB_TOKEN set: ${!!process.env.VERCEL_BLOB_TOKEN}`);

  // Generate branding images if requested
  if (generateImages) {
    const { name, ticker, tagline, colorScheme, description } = contentResult.data;
    let useGemini = useGeminiAI && !!process.env.GEMINI_API_KEY;

    // Try Gemini AI for token logo first
    if (useGemini) {
      try {
        console.log(`[AI Generator] 🎨 Using Gemini AI for token logo: ${name}`);
        
        // Generate AI image for token logo
        const aiPrompt = `${name} ${ticker ? `(${ticker})` : ''} - ${description || tagline || 'crypto token mascot'}`;
        const tokenLogoBuffer = await generateGeminiImage(aiPrompt, 'meme');
        
        // Save to file
        const outputDir = path.join(process.cwd(), 'image', 'ai-generated');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const ts = Date.now();
        const filename = `ai-${ticker?.toLowerCase() || 'token'}-${ts}.png`;
        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(filepath, tokenLogoBuffer);
        
        result.branding = {
          tokenLogo: filepath,
          tokenLogoUrl: `http://localhost:3001/image/ai-generated/${filename}`,
          aiGenerated: true,
        };
        
        console.log(`[AI Generator] ✅ Gemini AI token logo saved: ${filepath}`);
        
        // Upload to Vercel Blob if requested
        if (uploadImages && process.env.VERCEL_BLOB_TOKEN) {
          try {
            result.branding.tokenLogoUrl = await uploadToVercelBlob(
              tokenLogoBuffer,
              `${ticker?.toLowerCase() || 'token'}-ai-${ts}.png`
            );
            result.branding.uploaded = true;
            console.log('[AI Generator] ✅ AI token logo uploaded to Vercel Blob');
          } catch (uploadError) {
            console.error('[AI Generator] Upload error:', uploadError.message);
          }
        }
        
        // Still use BrandingGenerator for website logo and Twitter banner (they need text)
        if (BrandingGenerator) {
          try {
            const branding = new BrandingGenerator();
            const assets = await branding.generateAllAssets(name, ticker, {
              colorScheme: colorScheme || 'cyber',
              tagline: tagline,
            });
            
            if (assets.websiteLogo?.filename) {
              result.branding.websiteLogo = assets.websiteLogo.filepath;
              result.branding.websiteLogoUrl = `http://localhost:3001/image/createdlogos/${assets.websiteLogo.filename}`;
            }
            if (assets.twitterBanner?.filename) {
              result.branding.twitterBanner = assets.twitterBanner.filepath;
              result.branding.twitterBannerUrl = `http://localhost:3001/image/createdlogos/${assets.twitterBanner.filename}`;
            }
            
            // Upload website logo and banner if requested
            if (uploadImages && process.env.VERCEL_BLOB_TOKEN) {
              if (assets.websiteLogo?.buffer) {
                result.branding.websiteLogoUrl = await uploadToVercelBlob(
                  assets.websiteLogo.buffer,
                  `${ticker?.toLowerCase() || 'token'}-website-${ts}.png`
                );
              }
              if (assets.twitterBanner?.buffer) {
                result.branding.twitterBannerUrl = await uploadToVercelBlob(
                  assets.twitterBanner.buffer,
                  `${ticker?.toLowerCase() || 'token'}-twitter-${ts}.png`
                );
              }
              result.branding.uploaded = true;
            }
          } catch (brandingError) {
            console.error('[AI Generator] Secondary branding error:', brandingError.message);
          }
        }
        
      } catch (geminiError) {
        console.error('[AI Generator] Gemini AI error, falling back to static:', geminiError.message);
        useGemini = false; // Fall back to static generator
      }
    }
    
    // Fallback to static BrandingGenerator if Gemini not available or failed
    if (!useGemini && BrandingGenerator) {
      try {
        const branding = new BrandingGenerator();
        console.log(`[AI Generator] 🖼️ Using static branding for: ${name} (${ticker}) with colorScheme: ${colorScheme}`);

        const assets = await branding.generateAllAssets(name, ticker, {
          colorScheme: colorScheme || 'cyber',
          tagline: tagline,
        });

        // Assets return objects with { buffer, filepath, filename }
        result.branding = {
          tokenLogo: assets.tokenLogo?.filepath,
          websiteLogo: assets.websiteLogo?.filepath,
          twitterBanner: assets.twitterBanner?.filepath,
          aiGenerated: false,
        };

        // Convert filepaths to URLs for frontend access
        const baseUrl = 'http://localhost:3001';
        
        if (assets.tokenLogo?.filename) {
          result.branding.tokenLogoUrl = `${baseUrl}/image/createdlogos/${assets.tokenLogo.filename}`;
        }
        if (assets.websiteLogo?.filename) {
          result.branding.websiteLogoUrl = `${baseUrl}/image/createdlogos/${assets.websiteLogo.filename}`;
        }
        if (assets.twitterBanner?.filename) {
          result.branding.twitterBannerUrl = `${baseUrl}/image/createdlogos/${assets.twitterBanner.filename}`;
        }

        // Upload images if requested (overrides local URLs with Vercel Blob URLs)
        if (uploadImages && process.env.VERCEL_BLOB_TOKEN) {
          console.log('[AI Generator] Uploading branding to Vercel Blob...');
          
          const ts = Date.now();
          const prefix = ticker.toLowerCase();

          try {
            // Upload token logo (use buffer directly from asset)
            if (assets.tokenLogo?.buffer) {
              result.branding.tokenLogoUrl = await uploadToVercelBlob(
                assets.tokenLogo.buffer,
                `${prefix}-token-${ts}.png`
              );
              console.log('[AI Generator] ✅ Token logo uploaded:', result.branding.tokenLogoUrl);
            }

            // Upload website logo
            if (assets.websiteLogo?.buffer) {
              result.branding.websiteLogoUrl = await uploadToVercelBlob(
                assets.websiteLogo.buffer,
                `${prefix}-website-${ts}.png`
              );
              console.log('[AI Generator] ✅ Website logo uploaded:', result.branding.websiteLogoUrl);
            }

            // Upload Twitter banner
            if (assets.twitterBanner?.buffer) {
              result.branding.twitterBannerUrl = await uploadToVercelBlob(
                assets.twitterBanner.buffer,
                `${prefix}-twitter-${ts}.png`
              );
              console.log('[AI Generator] ✅ Twitter banner uploaded:', result.branding.twitterBannerUrl);
            }

            result.branding.uploaded = true;
          } catch (uploadError) {
            console.error('[AI Generator] Upload error:', uploadError.message);
            result.branding.uploaded = false;
            result.branding.uploadError = uploadError.message;
            // Keep local URLs as fallback
          }
        }
      } catch (brandingError) {
        console.error('[AI Generator] Branding error:', brandingError.message);
        console.error('[AI Generator] Branding error stack:', brandingError.stack);
        result.brandingError = brandingError.message;
      }
    } else if (!useGemini && !BrandingGenerator) {
      console.log('[AI Generator] ⚠️ Branding requested but no generator available');
    }
  } // End of generateImages block

  console.log('[AI Generator] Final result has branding:', !!result.branding);
  if (result.branding) {
    console.log('[AI Generator] Branding URLs:', {
      tokenLogoUrl: result.branding.tokenLogoUrl,
      websiteLogoUrl: result.branding.websiteLogoUrl,
      twitterBannerUrl: result.branding.twitterBannerUrl,
      uploaded: result.branding.uploaded,
    });
  }

  return result;
}

/**
 * Generate multiple variations with optional branding images
 */
async function generateVariationsWithBranding(prompt, count = 3, options = {}) {
  const { generateImages = false, uploadImages = false, useGeminiAI = true } = options;

  console.log(`[AI Generator] generateVariationsWithBranding called with count=${count}, generateImages=${generateImages}, useGeminiAI=${useGeminiAI}`);

  const variations = [];
  const brandingResults = [];
  const useGemini = useGeminiAI && !!process.env.GEMINI_API_KEY;

  for (let i = 0; i < count; i++) {
    // Generate content for this variation
    const result = await aiGenerator.generateContent(prompt, {
      ...options,
      // Slightly modify prompt for variation
      forceTemplate: options.forceTemplate || (i > 0 && !aiGenerator.useOpenAI),
    });

    if (!result.success) {
      console.log(`[AI Generator] Variation ${i + 1} content generation failed`);
      continue;
    }

    variations.push(result.data);

    // Generate branding for this variation if requested
    if (generateImages) {
      const { name, ticker, tagline, colorScheme, description } = result.data;
      const brandingData = { aiGenerated: false };
      
      // Try Gemini AI first for token logo
      if (useGemini) {
        try {
          console.log(`[AI Generator] 🎨 Variation ${i + 1}: Using Gemini AI for token logo: ${name}`);
          
          const aiPrompt = `${name} ${ticker ? `(${ticker})` : ''} - ${description || tagline || 'crypto token mascot'}`;
          const tokenLogoBuffer = await generateGeminiImage(aiPrompt, 'meme');
          
          // Save to file
          const outputDir = path.join(process.cwd(), 'image', 'ai-generated');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          const ts = Date.now();
          const filename = `ai-${ticker?.toLowerCase() || 'token'}-${ts}-v${i + 1}.png`;
          const filepath = path.join(outputDir, filename);
          fs.writeFileSync(filepath, tokenLogoBuffer);
          
          brandingData.tokenLogo = filepath;
          brandingData.tokenLogoUrl = `http://localhost:3001/image/ai-generated/${filename}`;
          brandingData.aiGenerated = true;
          
          console.log(`[AI Generator] ✅ Variation ${i + 1} Gemini AI token logo saved`);
          
          // Upload to Vercel Blob if requested
          if (uploadImages && process.env.VERCEL_BLOB_TOKEN) {
            try {
              brandingData.tokenLogoUrl = await uploadToVercelBlob(
                tokenLogoBuffer,
                `${ticker?.toLowerCase() || 'token'}-ai-${ts}-v${i + 1}.png`
              );
              brandingData.uploaded = true;
            } catch (uploadError) {
              console.error(`[AI Generator] Variation ${i + 1} upload error:`, uploadError.message);
            }
          }
          
        } catch (geminiError) {
          console.error(`[AI Generator] Variation ${i + 1} Gemini error, falling back:`, geminiError.message);
        }
      }
      
      // Use static branding for website logo and twitter banner (or as fallback for token logo)
      if (BrandingGenerator) {
        try {
          const branding = new BrandingGenerator();
          const assets = await branding.generateAllAssets(name, ticker, {
            colorScheme: colorScheme || 'cyber',
            tagline: tagline,
          });
          
          // Only use static token logo if AI didn't generate one
          if (!brandingData.tokenLogoUrl && assets.tokenLogo?.filepath) {
            const filename = require('path').basename(assets.tokenLogo.filepath);
            brandingData.tokenLogo = assets.tokenLogo.filepath;
            brandingData.tokenLogoUrl = `http://localhost:3001/image/createdlogos/${filename}`;
          }
          
          if (assets.websiteLogo?.filepath) {
            const filename = require('path').basename(assets.websiteLogo.filepath);
            brandingData.websiteLogo = assets.websiteLogo.filepath;
            brandingData.websiteLogoUrl = `http://localhost:3001/image/createdlogos/${filename}`;
          }
          if (assets.twitterBanner?.filepath) {
            const filename = require('path').basename(assets.twitterBanner.filepath);
            brandingData.twitterBanner = assets.twitterBanner.filepath;
            brandingData.twitterBannerUrl = `http://localhost:3001/image/createdlogos/${filename}`;
          }
          
          // Upload static assets if requested
          if (uploadImages && process.env.VERCEL_BLOB_TOKEN) {
            const ts = Date.now();
            const prefix = ticker?.toLowerCase() || 'token';
            
            if (assets.websiteLogo?.buffer) {
              brandingData.websiteLogoUrl = await uploadToVercelBlob(
                assets.websiteLogo.buffer,
                `${prefix}-website-${ts}-v${i + 1}.png`
              );
            }
            if (assets.twitterBanner?.buffer) {
              brandingData.twitterBannerUrl = await uploadToVercelBlob(
                assets.twitterBanner.buffer,
                `${prefix}-twitter-${ts}-v${i + 1}.png`
              );
            }
            brandingData.uploaded = true;
          }
        } catch (brandingError) {
          console.error(`[AI Generator] Variation ${i + 1} static branding error:`, brandingError.message);
        }
      }
      
      brandingResults.push(brandingData);
    } else {
      brandingResults.push(null);
    }
  }

  return {
    success: variations.length > 0,
    variations,
    brandingResults: generateImages ? brandingResults : undefined,
    source: aiGenerator.useOpenAI ? 'openai' : 'template',
  };
}

module.exports = {
  aiGenerator,
  AIGenerator,
  COLOR_SCHEMES,
  THEME_KEYWORDS,
  generateFromTemplate,
  generateContentWithBranding,
  generateVariationsWithBranding,
  uploadToVercelBlob,
  generateGeminiImage,
};
