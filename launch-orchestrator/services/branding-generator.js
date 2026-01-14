/**
 * Branding Generator Service
 * Creates consistent token logos, website logos, and Twitter banners
 */

const sharp = require('sharp');
const { createCanvas, registerFont, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

// Icon to keyword mapping for smart selection
const ICON_KEYWORDS = {
  // Animals
  'dog': ['dog', 'doge', 'shiba', 'inu', 'pup', 'puppy', 'woof', 'bark', 'canine', 'hound'],
  'cat': ['cat', 'kitty', 'meow', 'feline', 'kitten', 'neko', 'tiger', 'lion', 'panther'],
  'bird': ['bird', 'eagle', 'hawk', 'falcon', 'phoenix', 'crow', 'raven', 'owl', 'tweet'],
  'fish': ['fish', 'whale', 'shark', 'dolphin', 'ocean', 'sea', 'aqua', 'nemo'],
  'rabbit': ['rabbit', 'bunny', 'hare', 'hop'],
  'rat': ['rat', 'mouse', 'hamster', 'rodent'],
  'snake': ['snake', 'viper', 'python', 'cobra', 'serpent'],
  'turtle': ['turtle', 'tortoise', 'shell'],
  'bug': ['bug', 'beetle', 'ant', 'insect'],
  'squirrel': ['squirrel', 'nut', 'chipmunk'],
  'spider': ['spider', 'web', 'arachnid'],
  'unicorn': ['unicorn', 'magic', 'mythical', 'fantasy'],
  'paw-print': ['paw', 'pet', 'animal'],
  'bone': ['bone', 'skeleton'],
  
  // Power/Action
  'rocket': ['rocket', 'moon', 'mars', 'launch', 'space', 'sky', 'fly', 'boost', 'pump', 'up'],
  'zap': ['zap', 'electric', 'lightning', 'bolt', 'power', 'energy', 'shock', 'thunder', 'flash'],
  'flame': ['flame', 'fire', 'hot', 'burn', 'blaze', 'inferno', 'heat', 'lit'],
  'bolt': ['bolt', 'fast', 'quick', 'speed', 'rapid', 'lightning'],
  'bomb': ['bomb', 'boom', 'explode', 'blast', 'nuke', 'destroy', 'killer'],
  'tornado': ['tornado', 'storm', 'wind', 'cyclone', 'hurricane', 'twist'],
  'siren': ['siren', 'alert', 'alarm', 'warning', 'emergency'],
  
  // Wealth/Crypto
  'coins': ['coin', 'money', 'cash', 'rich', 'wealth', 'gold', 'silver', 'token'],
  'wallet': ['wallet', 'pay', 'bank', 'fund', 'finance'],
  'diamond': ['diamond', 'gem', 'jewel', 'precious', 'rare', 'hands', 'hodl'],
  'gem': ['gem', 'ruby', 'emerald', 'sapphire', 'crystal'],
  'crown': ['crown', 'king', 'queen', 'royal', 'prince', 'princess', 'ruler', 'boss'],
  'trophy': ['trophy', 'win', 'winner', 'champion', 'first', 'best', 'top'],
  'medal': ['medal', 'award', 'prize', 'honor', 'gold'],
  'dollar-sign': ['dollar', 'usd', 'money', 'rich', 'profit', 'gain'],
  'banknote': ['bank', 'note', 'bill', 'cash'],
  'briefcase': ['business', 'work', 'corp', 'enterprise'],
  
  // Gaming/Fun
  'gamepad-2': ['game', 'play', 'gamer', 'arcade', 'controller', 'esport'],
  'dice-1': ['dice', 'gamble', 'casino', 'bet', 'luck', 'chance', 'random'],
  'dice-5': ['dice', 'roll', 'lucky'],
  'puzzle': ['puzzle', 'solve', 'piece', 'riddle'],
  'gift': ['gift', 'present', 'reward', 'bonus', 'airdrop', 'giveaway'],
  'candy': ['candy', 'sweet', 'sugar', 'treat'],
  'cake': ['cake', 'birthday', 'party', 'celebrate'],
  'pizza': ['pizza', 'food', 'slice', 'hungry'],
  'target': ['target', 'aim', 'goal', 'focus', 'snipe', 'hit'],
  'crosshair': ['crosshair', 'scope', 'precision', 'accuracy'],
  
  // Mystic/Abstract
  'sparkles': ['sparkle', 'shine', 'glitter', 'magic', 'star', 'twinkle', 'bling'],
  'star': ['star', 'stellar', 'celestial', 'astro', 'super'],
  'moon': ['moon', 'lunar', 'night', 'dark', 'eclipse'],
  'sun': ['sun', 'solar', 'bright', 'day', 'light', 'shine'],
  'ghost': ['ghost', 'spooky', 'boo', 'phantom', 'spirit', 'haunt', 'dead'],
  'skull': ['skull', 'death', 'dead', 'skeleton', 'bone', 'pirate', 'danger'],
  'wand': ['wand', 'wizard', 'witch', 'magic', 'spell', 'harry'],
  'infinity': ['infinity', 'infinite', 'endless', 'forever', 'eternal', 'loop'],
  'atom': ['atom', 'science', 'nuclear', 'physics', 'quantum', 'molecule'],
  'brain': ['brain', 'smart', 'think', 'mind', 'intel', 'genius', 'ai', 'neural'],
  'eye': ['eye', 'see', 'watch', 'vision', 'look', 'spy', 'observe'],
  'hexagon': ['hex', 'hive', 'bee', 'crypto', 'block', 'chain'],
  'triangle': ['triangle', 'pyramid', 'delta', 'illuminati'],
  'orbit': ['orbit', 'planet', 'satellite', 'space', 'cosmos'],
  
  // Tech
  'bot': ['bot', 'robot', 'auto', 'ai', 'machine', 'cyber', 'android'],
  'terminal': ['terminal', 'code', 'dev', 'hack', 'program', 'matrix'],
  'shield': ['shield', 'safe', 'protect', 'guard', 'secure', 'defense', 'armor'],
  'lock': ['lock', 'secure', 'private', 'safe', 'protect'],
  'key': ['key', 'unlock', 'access', 'secret', 'password'],
  'verified': ['verified', 'check', 'legit', 'real', 'authentic', 'trust'],
  'fingerprint': ['finger', 'print', 'identity', 'unique', 'bio'],
  
  // Nature
  'leaf': ['leaf', 'green', 'eco', 'nature', 'plant', 'tree', 'organic'],
  'tree': ['tree', 'forest', 'wood', 'grow', 'branch'],
  'mountain': ['mountain', 'peak', 'summit', 'climb', 'high', 'top'],
  'waves': ['wave', 'ocean', 'sea', 'surf', 'water', 'beach', 'tide'],
  'wind': ['wind', 'air', 'breeze', 'blow', 'gust'],
  'rainbow': ['rainbow', 'color', 'pride', 'spectrum'],
  'snowflake': ['snow', 'ice', 'cold', 'freeze', 'winter', 'frost'],
  'feather': ['feather', 'light', 'bird', 'fly', 'float'],
  'clover': ['clover', 'luck', 'lucky', 'irish', 'four'],
};

// Color schemes
const COLOR_SCHEMES = {
  purple: { primary: '#8B5CF6', secondary: '#A78BFA', accent: '#C4B5FD', dark: '#4C1D95', bg: '#1a1025' },
  blue: { primary: '#3B82F6', secondary: '#60A5FA', accent: '#93C5FD', dark: '#1E40AF', bg: '#0a1628' },
  green: { primary: '#10B981', secondary: '#34D399', accent: '#6EE7B7', dark: '#047857', bg: '#0a1f1a' },
  red: { primary: '#EF4444', secondary: '#F87171', accent: '#FCA5A5', dark: '#B91C1C', bg: '#1f0a0a' },
  orange: { primary: '#F97316', secondary: '#FB923C', accent: '#FDBA74', dark: '#C2410C', bg: '#1f150a' },
  pink: { primary: '#EC4899', secondary: '#F472B6', accent: '#F9A8D4', dark: '#BE185D', bg: '#1f0a18' },
  cyan: { primary: '#06B6D4', secondary: '#22D3EE', accent: '#67E8F9', dark: '#0E7490', bg: '#0a1a1f' },
  yellow: { primary: '#EAB308', secondary: '#FACC15', accent: '#FDE047', dark: '#A16207', bg: '#1f1a0a' },
  gold: { primary: '#D4AF37', secondary: '#FFD700', accent: '#FFE55C', dark: '#996515', bg: '#1a1508' },
};

// Suffixes to render as superscript
const SUPERSCRIPT_SUFFIXES = ['AI', 'IO', 'FI', 'DAO', 'DEX', 'NFT', 'INU', 'COIN', 'TOKEN', 'PROTOCOL', 'LABS', 'NETWORK', 'CHAIN', 'X', 'PRO', 'V2', 'V3'];

// Professional typography styles - intelligent color usage
const TYPOGRAPHY_STYLES = {
  // First word colored (primary), rest white - most professional
  firstColored: (words, colors) => {
    return words.map((word, i) => ({
      text: word,
      color: i === 0 ? colors.primary : '#FFFFFF',
      weight: i === 0 ? 700 : 400, // First word bold, rest regular
    }));
  },
  // First word colored and bold, rest lighter weight
  professional: (words, colors) => {
    return words.map((word, i) => ({
      text: word,
      color: i === 0 ? colors.primary : '#FFFFFF',
      weight: i === 0 ? 700 : 300, // First word bold, rest thin
    }));
  },
  // Subtle gradient from primary to white
  gradient: (words, colors) => {
    if (words.length === 1) {
      return [{ text: words[0], color: colors.primary, weight: 700 }];
    }
    // First word primary, fade to white
    return words.map((word, i) => {
      const ratio = i / (words.length - 1);
      const r = Math.floor(parseInt(colors.primary.slice(1, 3), 16) * (1 - ratio) + 255 * ratio);
      const g = Math.floor(parseInt(colors.primary.slice(3, 5), 16) * (1 - ratio) + 255 * ratio);
      const b = Math.floor(parseInt(colors.primary.slice(5, 7), 16) * (1 - ratio) + 255 * ratio);
      const hex = `#${[r, g, b].map(x => {
        const h = Math.min(255, Math.max(0, x)).toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('')}`;
      return {
        text: word,
        color: hex,
        weight: i === 0 ? 700 : 400,
      };
    });
  },
  // Default: first word colored, rest white
  default: (words, colors) => {
    return words.map((word, i) => ({
      text: word,
      color: i === 0 ? colors.primary : '#FFFFFF',
      weight: i === 0 ? 700 : 400,
    }));
  },
};

class BrandingGenerator {
  constructor() {
    this.iconsDir = path.join(__dirname, '..', 'assets', 'icons');
    this.alphabetDir = path.join(__dirname, '..', '..', 'image', 'logo-library', 'Alphabet');
    this.shapeLogosDir = path.join(__dirname, '..', '..', 'image', 'logo-library', 'shape-logos');
    this.shapeLogosMetadataPath = path.join(this.shapeLogosDir, 'shape-logos-metadata.json');
    this.outputDir = path.join(__dirname, '..', '..', 'image', 'createdlogos');
    
    // Load shape logos metadata
    this.shapeLogosMetadata = null;
    this.loadShapeLogosMetadata();
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
  
  /**
   * Load shape logos metadata for quick lookup
   */
  loadShapeLogosMetadata() {
    try {
      if (fs.existsSync(this.shapeLogosMetadataPath)) {
        const data = fs.readFileSync(this.shapeLogosMetadataPath, 'utf8');
        this.shapeLogosMetadata = JSON.parse(data);
        logger.info(`✅ Loaded ${Object.keys(this.shapeLogosMetadata.logos || {}).length} shape logos metadata`);
      } else {
        logger.warn(`⚠️ Shape logos metadata not found: ${this.shapeLogosMetadataPath}`);
      }
    } catch (error) {
      logger.error(`❌ Failed to load shape logos metadata: ${error.message}`);
    }
  }
  
  /**
   * Get shape logo by color preference
   * @param {string} preferredColor - Color name (e.g., 'blue', 'purple', 'orange')
   * @param {string} preferredBrightness - 'dark', 'medium', or 'bright'
   * @returns {string|null} Path to shape logo or null
   */
  getShapeLogoByColor(preferredColor = null, preferredBrightness = null) {
    if (!this.shapeLogosMetadata || !this.shapeLogosMetadata.logos) {
      return null;
    }
    
    const logos = Object.entries(this.shapeLogosMetadata.logos);
    
    // If no preference, return random logo
    if (!preferredColor && !preferredBrightness) {
      const randomLogo = logos[Math.floor(Math.random() * logos.length)];
      return path.join(this.shapeLogosDir, randomLogo[0]);
    }
    
    // Filter by preferences
    let candidates = logos;
    
    if (preferredColor) {
      candidates = candidates.filter(([_, data]) => 
        data.primaryColor === preferredColor.toLowerCase()
      );
    }
    
    if (preferredBrightness && candidates.length > 0) {
      candidates = candidates.filter(([_, data]) => 
        data.brightnessLevel === preferredBrightness.toLowerCase()
      );
    }
    
    // If no exact match, try just color
    if (candidates.length === 0 && preferredColor) {
      candidates = logos.filter(([_, data]) => 
        data.primaryColor === preferredColor.toLowerCase()
      );
    }
    
    // If still no match, return random
    if (candidates.length === 0) {
      candidates = logos;
    }
    
    // Return random from candidates
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    return path.join(this.shapeLogosDir, selected[0]);
  }
  
  /**
   * Get all shape logos matching criteria
   * @param {object} criteria - { color, brightness }
   * @returns {Array} Array of logo filenames
   */
  getShapeLogosByCriteria(criteria = {}) {
    if (!this.shapeLogosMetadata || !this.shapeLogosMetadata.logos) {
      return [];
    }
    
    let logos = Object.entries(this.shapeLogosMetadata.logos);
    
    if (criteria.color) {
      logos = logos.filter(([_, data]) => 
        data.primaryColor === criteria.color.toLowerCase()
      );
    }
    
    if (criteria.brightness) {
      logos = logos.filter(([_, data]) => 
        data.brightnessLevel === criteria.brightness.toLowerCase()
      );
    }
    
    return logos.map(([filename, _]) => filename);
  }

  /**
   * Get alphabet logo path based on first letter of token name or symbol
   */
  getAlphabetLogoPath(letter) {
    if (!letter || typeof letter !== 'string') {
      logger.warn(`getAlphabetLogoPath: Invalid letter parameter: ${letter}`);
      return null;
    }
    
    const normalizedLetter = letter.toLowerCase().charAt(0);
    const logoPath = path.join(this.alphabetDir, `${normalizedLetter}.png`);
    
    // Debug: Log the path being checked
    logger.info(`Checking alphabet logo: ${logoPath} (letter: "${normalizedLetter}", dir exists: ${fs.existsSync(this.alphabetDir)})`);
    
    if (fs.existsSync(logoPath)) {
      logger.info(`✅ Alphabet logo found: ${logoPath}`);
      return logoPath;
    }
    
    logger.warn(`❌ Alphabet logo not found: ${logoPath}`);
    return null;
  }

  /**
   * Extract dominant colors from an alphabet logo
   */
  async extractLogoColors(logoPath) {
    try {
      const image = await loadImage(logoPath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, image.width, image.height);
      const pixels = imageData.data;
      const colorMap = new Map();
      
      // Sample pixels (skip transparent)
      const step = Math.max(1, Math.floor((pixels.length / 4) / 500));
      for (let i = 0; i < pixels.length; i += step * 4) {
        const a = pixels[i + 3];
        if (a < 128) continue; // Skip transparent
        
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        // Quantize colors
        const qr = Math.floor(r / 32) * 32;
        const qg = Math.floor(g / 32) * 32;
        const qb = Math.floor(b / 32) * 32;
        
        const key = `${qr},${qg},${qb}`;
        colorMap.set(key, (colorMap.get(key) || 0) + 1);
      }
      
      // Get top 3 colors
      const sorted = Array.from(colorMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key]) => {
          const [r, g, b] = key.split(',').map(Number);
          return {
            r, g, b,
            hex: `#${[r, g, b].map(x => {
              const hex = x.toString(16);
              return hex.length === 1 ? '0' + hex : hex;
            }).join('')}`
          };
        });
      
      return {
        primary: sorted[0] || { r: 128, g: 128, b: 128, hex: '#808080' },
        secondary: sorted[1] || sorted[0] || { r: 128, g: 128, b: 128, hex: '#808080' },
        accent: sorted[2] || sorted[1] || sorted[0] || { r: 128, g: 128, b: 128, hex: '#808080' }
      };
    } catch (error) {
      logger.warn(`Failed to extract colors from logo: ${error.message}`);
      // Return neutral colors as fallback
      return {
        primary: { r: 128, g: 128, b: 128, hex: '#808080' },
        secondary: { r: 100, g: 100, b: 100, hex: '#646464' },
        accent: { r: 160, g: 160, b: 160, hex: '#a0a0a0' }
      };
    }
  }

  /**
   * Find the best matching icon for a token name
   */
  findBestIcon(tokenName) {
    const nameLower = tokenName.toLowerCase();
    const words = nameLower.split(/\s+/);
    
    // Score each icon based on keyword matches
    let bestIcon = 'rocket'; // Default
    let bestScore = 0;
    
    for (const [icon, keywords] of Object.entries(ICON_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (nameLower.includes(keyword)) {
          score += keyword.length; // Longer matches score higher
        }
        for (const word of words) {
          if (word === keyword) {
            score += 10; // Exact word match scores highest
          } else if (word.includes(keyword) || keyword.includes(word)) {
            score += 5; // Partial match
          }
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestIcon = icon;
      }
    }
    
    // Check if the icon file exists
    const iconPath = path.join(this.iconsDir, `${bestIcon}.svg`);
    if (!fs.existsSync(iconPath)) {
      logger.warn(`Icon ${bestIcon} not found, using rocket`);
      bestIcon = 'rocket';
    }
    
    return bestIcon;
  }

  /**
   * Get color scheme based on name or preference
   */
  getColorScheme(colorName = 'purple') {
    return COLOR_SCHEMES[colorName] || COLOR_SCHEMES.purple;
  }

  /**
   * Get contrasting background color for a given color
   * Returns a dark background for light colors, light for dark colors
   */
  getContrastingBackground(color) {
    // Calculate brightness
    const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
    
    if (brightness > 128) {
      // Light color - use dark background
      return '#0a0a0a'; // Deep black
    } else {
      // Dark color - use slightly lighter dark background
      return '#1a1a1a'; // Dark gray
    }
  }

  /**
   * Load and colorize an SVG icon
   */
  async loadColorizedIcon(iconName, color, size = 300) {
    const iconPath = path.join(this.iconsDir, `${iconName}.svg`);
    
    if (!fs.existsSync(iconPath)) {
      throw new Error(`Icon not found: ${iconName}`);
    }
    
    let svgContent = fs.readFileSync(iconPath, 'utf-8');
    
    // Replace stroke color (Lucide icons use currentColor)
    svgContent = svgContent
      .replace(/stroke="currentColor"/g, `stroke="${color}"`)
      .replace(/stroke-width="2"/g, 'stroke-width="1.5"')
      .replace(/width="24"/g, `width="${size}"`)
      .replace(/height="24"/g, `height="${size}"`);
    
    // Convert SVG to PNG buffer
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .resize(size, size)
      .png()
      .toBuffer();
    
    return pngBuffer;
  }

  /**
   * Smart logo selection: prefers shape logos when they match color scheme
   * @returns {object} { useAlphabetLogo, useShapeLogo, alphabetLogoPath, shapeLogoPath }
   */
  selectBestLogo(tokenName, colorScheme) {
    const alphabetLogoPath = this.getAlphabetLogoPath(tokenName);
    const hasAlphabetLogo = alphabetLogoPath !== null;
    
    // Map color scheme to shape logo color preference
    const colorMap = {
      'purple': 'purple',
      'blue': 'blue',
      'green': 'green',
      'red': 'red',
      'orange': 'orange',
      'pink': 'pink',
      'cyan': 'cyan',
      'yellow': 'yellow',
      'gold': 'gold',
      'matrix': 'cyan',  // Matrix theme -> cyan
      'cyber': 'blue',   // Cyber theme -> blue
      'neon': 'green'    // Neon theme -> green
    };
    
    const preferredColor = colorMap[colorScheme] || null;
    const shapeLogoPath = preferredColor ? this.getShapeLogoByColor(preferredColor, 'medium') : null;
    const hasShapeLogo = shapeLogoPath !== null;
    
    // Smart selection: prefer shape logo if it matches color scheme, otherwise use alphabet logo
    let useAlphabetLogo = false;
    let useShapeLogo = false;
    
    if (hasShapeLogo && preferredColor) {
      // Shape logo matches color scheme - prefer it
      useShapeLogo = true;
      logger.info(`✅ Selected shape logo (color-matched): ${path.basename(shapeLogoPath)} (color: ${preferredColor})`);
    } else if (hasAlphabetLogo) {
      // Use alphabet logo as fallback or if no color-matched shape logo
      useAlphabetLogo = true;
      logger.info(`✅ Selected alphabet logo: ${path.basename(alphabetLogoPath)}`);
    } else if (hasShapeLogo) {
      // No alphabet logo but have shape logo - use it
      useShapeLogo = true;
      logger.info(`✅ Selected shape logo (fallback): ${path.basename(shapeLogoPath)}`);
    }
    
    return {
      useAlphabetLogo,
      useShapeLogo,
      alphabetLogoPath: useAlphabetLogo ? alphabetLogoPath : null,
      shapeLogoPath: useShapeLogo ? shapeLogoPath : null
    };
  }

  /**
   * Generate token logo (500x500 with background)
   * Now uses alphabet logos from image/logo-library/Alphabet/
   */
  async generateTokenLogo(tokenName, options = {}) {
    const {
      colorScheme = 'purple',
      iconName = null,
      size = 500,
      logoSelection = null,
    } = options;

    logger.info(`Generating token logo for: ${tokenName}`);
    
    // Use passed logoSelection or select now (for standalone calls)
    const selection = logoSelection || this.selectBestLogo(tokenName, colorScheme);
    const { useAlphabetLogo, useShapeLogo, alphabetLogoPath, shapeLogoPath } = selection;
    
    const icon = iconName || this.findBestIcon(tokenName);
    let colors = this.getColorScheme(colorScheme);
    let logoColors = null;
    
    // Extract colors from logo if available (alphabet or shape)
    if (useAlphabetLogo) {
      logoColors = await this.extractLogoColors(alphabetLogoPath);
      logger.info(`Using alphabet logo: ${alphabetLogoPath}`);
      logger.info(`Extracted colors - Primary: ${logoColors.primary.hex}, Secondary: ${logoColors.secondary.hex}`);
    } else if (useShapeLogo) {
      logoColors = await this.extractLogoColors(shapeLogoPath);
      logger.info(`Using shape logo: ${shapeLogoPath}`);
      logger.info(`Extracted colors - Primary: ${logoColors.primary.hex}, Secondary: ${logoColors.secondary.hex}`);
    } else {
      logger.info(`Using icon: ${icon}, color scheme: ${colorScheme}`);
    }
    
    // Create canvas
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    const useCustomLogo = useAlphabetLogo || useShapeLogo;
    
    // Professional clean background - use logo colors or neutral
    const bgColor = useCustomLogo && logoColors 
      ? this.getContrastingBackground(logoColors.primary) 
      : '#0a0a0a'; // Deep black for professional look
    
    // Draw clean rounded rectangle background (no gradient, no glow)
    const radius = size * 0.12;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.fillStyle = bgColor;
    ctx.fill();
    
    // Subtle border only (no glow)
    const borderColor = useCustomLogo && logoColors
      ? logoColors.primary.hex + '20' // 20% opacity
      : '#ffffff08'; // Very subtle white border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // NO GLOW EFFECTS - clean and professional
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    
    // Load and draw logo (alphabet logo, shape logo, or icon)
    const logoSize = size * 0.65; // Slightly larger for better visibility
    let logoImage;
    
    if (useAlphabetLogo) {
      // Use alphabet logo directly - it already has its own styling
      try {
        logger.info(`Loading alphabet logo from: ${alphabetLogoPath}`);
        logoImage = await loadImage(alphabetLogoPath);
        logger.success(`✅ Alphabet logo loaded successfully (${logoImage.width}x${logoImage.height})`);
      } catch (error) {
        logger.error(`❌ Failed to load alphabet logo: ${error.message}`);
        logger.warn(`Falling back to shape logo or icon`);
        // Try shape logo as fallback
        if (useShapeLogo && shapeLogoPath) {
          try {
            logoImage = await loadImage(shapeLogoPath);
            logger.success(`✅ Shape logo loaded as fallback`);
          } catch (shapeError) {
            logger.error(`❌ Failed to load shape logo: ${shapeError.message}`);
            // Final fallback to icon
            const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, logoSize);
            logoImage = await loadImage(iconBuffer);
          }
        } else {
          // Fallback to icon
          const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, logoSize);
          logoImage = await loadImage(iconBuffer);
        }
      }
    } else if (useShapeLogo && shapeLogoPath) {
      // Use shape logo directly
      try {
        logger.info(`Loading shape logo from: ${shapeLogoPath}`);
        logoImage = await loadImage(shapeLogoPath);
        logger.success(`✅ Shape logo loaded successfully (${logoImage.width}x${logoImage.height})`);
      } catch (error) {
        logger.error(`❌ Failed to load shape logo: ${error.message}`);
        logger.warn(`Falling back to icon: ${icon}`);
        // Fallback to icon
        const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, logoSize);
        logoImage = await loadImage(iconBuffer);
      }
    } else {
      // Use SVG icon (fallback) - no colorization, use original
      const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, logoSize);
      logoImage = await loadImage(iconBuffer);
    }
    
    const logoX = (size - logoSize) / 2;
    const logoY = (size - logoSize) / 2;
    ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
    
    // Convert to buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Save to file
    const filename = `token-logo-${Date.now()}.png`;
    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    
    logger.success(`Token logo saved: ${filename}`);
    
    return {
      buffer,
      filepath,
      filename,
      icon: useAlphabetLogo ? `alphabet-${tokenName.charAt(0).toLowerCase()}` : (useShapeLogo ? `shape-${path.basename(shapeLogoPath, '.png')}` : icon),
      colorScheme,
      usedAlphabetLogo: useAlphabetLogo,
      usedShapeLogo: useShapeLogo,
    };
  }

  /**
   * Parse token name to extract main text and suffix (e.g., "DOGWOLF AI" -> ["DOGWOLF", "AI"])
   */
  parseTokenName(tokenName) {
    const upper = tokenName.toUpperCase();
    const words = upper.split(/\s+/);
    
    // Check if last word is a suffix
    let suffix = null;
    let mainWords = [...words];
    
    if (words.length > 1) {
      const lastWord = words[words.length - 1];
      if (SUPERSCRIPT_SUFFIXES.includes(lastWord)) {
        suffix = lastWord;
        mainWords = words.slice(0, -1);
      }
    }
    
    return { mainWords, suffix, fullName: upper };
  }

  /**
   * Smart split a compound word (e.g., "DOGWOLF" -> ["DOG", "WOLF"])
   */
  smartSplitWord(word) {
    // Common prefixes/suffixes to split on
    const splitPatterns = [
      // Animal combinations
      /^(DOG|CAT|WOLF|BEAR|BULL|APE|FROG|PEPE|SHIB|DOGE|FLOKI|BONK|WIF)(.*)/i,
      // Crypto terms
      /^(MOON|SAFE|BABY|MINI|MEGA|SUPER|ULTRA|HYPER|TURBO)(.*)/i,
      // Action words
      /^(PUMP|DUMP|HODL|YOLO|FOMO|WAGMI)(.*)/i,
    ];
    
    for (const pattern of splitPatterns) {
      const match = word.match(pattern);
      if (match && match[1] && match[2] && match[2].length >= 2) {
        return [match[1], match[2]];
      }
    }
    
    // Try to split in middle if word is long enough
    if (word.length >= 6) {
      // Look for natural break points (consonant clusters)
      const midPoint = Math.floor(word.length / 2);
      // Try to find a good split point near the middle
      for (let i = midPoint; i < word.length - 1; i++) {
        const char = word[i];
        const nextChar = word[i + 1];
        // Split between vowel and consonant
        if ('AEIOU'.includes(char) && !'AEIOU'.includes(nextChar)) {
          return [word.slice(0, i + 1), word.slice(i + 1)];
        }
      }
    }
    
    return [word]; // Return as-is if no split found
  }

  /**
   * Generate website logo (transparent, icon + text) - CREATIVE VERSION
   */
  async generateWebsiteLogo(tokenName, ticker, options = {}) {
    const {
      colorScheme = 'purple',
      iconName = null,
      height = 80,
      style = 'professional', // professional, firstColored, gradient
      logoSelection = null,
    } = options;

    logger.info(`Generating website logo for: ${tokenName} (${ticker})`);
    
    // Use passed logoSelection or select now (for standalone calls)
    const selection = logoSelection || this.selectBestLogo(tokenName, colorScheme);
    const { useAlphabetLogo, useShapeLogo, alphabetLogoPath, shapeLogoPath } = selection;
    
    const icon = iconName || this.findBestIcon(tokenName);
    let colors = this.getColorScheme(colorScheme);
    const { mainWords, suffix } = this.parseTokenName(tokenName);
    
    // Calculate dimensions
    const iconSize = height * 0.9;
    const padding = height * 0.15;
    const fontSize = height * 0.5;
    const suffixFontSize = height * 0.22;
    const letterSpacing = 2;
    
    // Process words - only split compound words, keep space-separated words intact
    let processedWords = [];
    // If token name has multiple words (separated by spaces), don't split them further
    // Only use smartSplitWord for single compound words (e.g., "DOGWOLF" -> ["DOG", "WOLF"])
    const shouldSplitWords = mainWords.length === 1; // Only split if it's a single compound word
    
    for (const word of mainWords) {
      if (shouldSplitWords) {
        // Single compound word - try to split intelligently
        const splits = this.smartSplitWord(word);
        processedWords.push(...splits);
      } else {
        // Multiple words already separated - keep them intact
        processedWords.push(word);
      }
    }
    
    // Apply professional typography style
    const styleFunc = TYPOGRAPHY_STYLES[style] || TYPOGRAPHY_STYLES.professional;
    let styledWords = styleFunc(processedWords, colors);
    
    // Create temp canvas to measure text with different weights
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext('2d');
    
    // Measure all words with their respective weights
    let totalTextWidth = 0;
    styledWords.forEach((w, i) => {
      const weight = w.weight || (i === 0 ? 700 : 400);
      tempCtx.font = `${weight} ${fontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      totalTextWidth += tempCtx.measureText(w.text).width;
      if (i < styledWords.length - 1) totalTextWidth += letterSpacing;
    });
    
    // Add suffix width if present
    let suffixWidth = 0;
    if (suffix) {
      tempCtx.font = `700 ${suffixFontSize}px "Segoe UI", sans-serif`;
      suffixWidth = tempCtx.measureText(suffix).width + 8;
    }
    
    // Calculate total width
    const totalWidth = iconSize + padding * 2 + totalTextWidth + suffixWidth + padding;
    
    // Create main canvas
    const canvas = createCanvas(totalWidth, height);
    const ctx = canvas.getContext('2d');
    
    // Extract colors from logo if available (alphabet or shape)
    let logoColors = null;
    if (useAlphabetLogo) {
      logoColors = await this.extractLogoColors(alphabetLogoPath);
      if (logoColors) {
        colors = {
          primary: logoColors.primary.hex,
          secondary: logoColors.secondary.hex,
          accent: logoColors.accent.hex,
          dark: this.getContrastingBackground(logoColors.primary),
          bg: this.getContrastingBackground(logoColors.primary)
        };
      }
    } else if (useShapeLogo && shapeLogoPath) {
      logoColors = await this.extractLogoColors(shapeLogoPath);
      if (logoColors) {
        colors = {
          primary: logoColors.primary.hex,
          secondary: logoColors.secondary.hex,
          accent: logoColors.accent.hex,
          dark: this.getContrastingBackground(logoColors.primary),
          bg: this.getContrastingBackground(logoColors.primary)
        };
      }
    }
    
    // Draw logo (alphabet logo, shape logo, or icon) - NO GLOW, clean and professional
    ctx.shadowBlur = 0; // No glow effects
    
    let logoImage;
    
    if (useAlphabetLogo) {
      // Use alphabet logo directly
      logoImage = await loadImage(alphabetLogoPath);
    } else if (useShapeLogo && shapeLogoPath) {
      // Use shape logo directly
      logoImage = await loadImage(shapeLogoPath);
    } else {
      // Use SVG icon (fallback)
      const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, Math.floor(iconSize));
      logoImage = await loadImage(iconBuffer);
    }
    
    const iconY = (height - iconSize) / 2;
    ctx.drawImage(logoImage, padding / 2, iconY, iconSize, iconSize);
    
    // Draw styled words with professional typography - different weights
    ctx.textBaseline = 'middle';
    
    let xPos = iconSize + padding * 1.5;
    const yPos = height / 2 + 2; // Slight adjustment for visual centering
    
    // Use logo colors if available - intelligent color application
    if (logoColors) {
      styledWords = styledWords.map((w, i) => ({
        text: w.text,
        color: i === 0 ? logoColors.primary.hex : '#FFFFFF',
        weight: w.weight || (i === 0 ? 700 : 300) // First word bold, rest thin
      }));
    }
    
    for (let i = 0; i < styledWords.length; i++) {
      const { text, color, weight = (i === 0 ? 700 : 300) } = styledWords[i];
      
      // Professional font stack
      ctx.font = `${weight} ${fontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      
      // Minimal shadow for readability only (not glow)
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 0.5;
      ctx.shadowOffsetY = 0.5;
      
      ctx.fillStyle = color;
      ctx.fillText(text, xPos, yPos);
      
      // Measure text with current font to get accurate width
      const metrics = ctx.measureText(text);
      xPos += metrics.width + letterSpacing;
    }
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Draw suffix as superscript - professional styling
    if (suffix) {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.font = `500 ${suffixFontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      
      // Position at top-right of the main text
      const suffixX = xPos + 4;
      const suffixY = height * 0.28;
      
      // Draw suffix with subtle background
      const suffixMetrics = ctx.measureText(suffix);
      const bgPadding = 4;
      
      // Subtle rounded background for suffix
      const bgColor = logoColors ? logoColors.primary.hex + '25' : colors.primary + '25';
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(
        suffixX - bgPadding,
        suffixY - suffixFontSize / 2 - bgPadding / 2,
        suffixMetrics.width + bgPadding * 2,
        suffixFontSize + bgPadding,
        4
      );
      ctx.fill();
      
      // Draw suffix text
      ctx.fillStyle = logoColors ? logoColors.primary.hex : colors.primary;
      ctx.textBaseline = 'middle';
      ctx.fillText(suffix, suffixX, suffixY);
    }
    
    // Convert to buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Save to file
    const filename = `website-logo-${Date.now()}.png`;
    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    
    logger.success(`Website logo saved: ${filename}`);
    
    return {
      buffer,
      filepath,
      filename,
      icon: useAlphabetLogo ? `alphabet-${tokenName.charAt(0).toLowerCase()}` : (useShapeLogo ? `shape-${path.basename(shapeLogoPath, '.png')}` : icon),
      colorScheme,
      width: totalWidth,
      height,
      style,
      usedAlphabetLogo: useAlphabetLogo,
      usedShapeLogo: useShapeLogo,
    };
  }

  /**
   * Generate Twitter banner (1500x500) - CREATIVE VERSION
   */
  async generateTwitterBanner(tokenName, ticker, options = {}) {
    const {
      colorScheme = 'purple',
      iconName = null,
      tagline = null,
      style = 'professional',
      logoSelection = null,
    } = options;

    logger.info(`Generating Twitter banner for: ${tokenName}`);
    
    // Use passed logoSelection or select now (for standalone calls)
    const selection = logoSelection || this.selectBestLogo(tokenName, colorScheme);
    const { useAlphabetLogo, useShapeLogo, alphabetLogoPath, shapeLogoPath } = selection;
    
    const width = 1500;
    const height = 500;
    const icon = iconName || this.findBestIcon(tokenName);
    let colors = this.getColorScheme(colorScheme);
    const { mainWords, suffix } = this.parseTokenName(tokenName);
    
    // Extract colors from logo if available (alphabet or shape)
    let logoColors = null;
    if (useAlphabetLogo) {
      logoColors = await this.extractLogoColors(alphabetLogoPath);
      if (logoColors) {
        colors = {
          primary: logoColors.primary.hex,
          secondary: logoColors.secondary.hex,
          accent: logoColors.accent.hex,
          dark: this.getContrastingBackground(logoColors.primary),
          bg: this.getContrastingBackground(logoColors.primary)
        };
      }
    } else if (useShapeLogo && shapeLogoPath) {
      logoColors = await this.extractLogoColors(shapeLogoPath);
      if (logoColors) {
        colors = {
          primary: logoColors.primary.hex,
          secondary: logoColors.secondary.hex,
          accent: logoColors.accent.hex,
          dark: this.getContrastingBackground(logoColors.primary),
          bg: this.getContrastingBackground(logoColors.primary)
        };
      }
    }
    
    const useCustomLogo = useAlphabetLogo || useShapeLogo;
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Clean, professional background - use logo colors or neutral
    const bgColor = useCustomLogo && logoColors
      ? this.getContrastingBackground(logoColors.primary)
      : '#0a0a0a'; // Deep black
    
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    
    // Subtle accent line at bottom (minimal design)
    if (useCustomLogo && logoColors) {
      ctx.strokeStyle = logoColors.primary.hex + '30'; // 30% opacity
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(100, height - 60);
      ctx.lineTo(width - 100, height - 60);
      ctx.stroke();
    }
    
    // Draw logo (alphabet logo, shape logo, or icon) (left side) - NO GLOW, professional
    const iconSize = 220;
    ctx.shadowBlur = 0; // No glow effects
    
    let logoImage;
    
    if (useAlphabetLogo) {
      // Use alphabet logo directly
      logoImage = await loadImage(alphabetLogoPath);
    } else if (useShapeLogo && shapeLogoPath) {
      // Use shape logo directly
      logoImage = await loadImage(shapeLogoPath);
    } else {
      // Use SVG icon (fallback)
      const iconBuffer = await this.loadColorizedIcon(icon, colors.primary, iconSize);
      logoImage = await loadImage(iconBuffer);
    }
    
    ctx.drawImage(logoImage, 130, (height - iconSize) / 2 - 10, iconSize, iconSize);
    
    // Process words for split coloring
    // Only split compound words, keep space-separated words intact
    let processedWords = [];
    // If token name has multiple words (separated by spaces), don't split them further
    // Only use smartSplitWord for single compound words (e.g., "DOGWOLF" -> ["DOG", "WOLF"])
    const shouldSplitWords = mainWords.length === 1; // Only split if it's a single compound word
    
    for (const word of mainWords) {
      if (shouldSplitWords) {
        // Single compound word - try to split intelligently
        const splits = this.smartSplitWord(word);
        processedWords.push(...splits);
      } else {
        // Multiple words already separated - keep them intact
        processedWords.push(word);
      }
    }
    
    // Apply professional typography style
    const styleFunc = TYPOGRAPHY_STYLES[style] || TYPOGRAPHY_STYLES.professional;
    let styledWords = styleFunc(processedWords, colors);
    
    // Draw token name with professional styling
    const fontSize = 90;
    const letterSpacing = 4;
    ctx.textBaseline = 'middle';
    
    let xPos = 400;
    const yPos = height / 2 - 40;
    
    // Use logo colors if available - intelligent color application
    if (logoColors) {
      styledWords = styledWords.map((w, i) => ({
        text: w.text,
        color: i === 0 ? logoColors.primary.hex : '#FFFFFF',
        weight: w.weight || (i === 0 ? 700 : 300) // First word bold, rest thin
      }));
    }
    
    for (let i = 0; i < styledWords.length; i++) {
      const { text, color, weight = (i === 0 ? 700 : 300) } = styledWords[i];
      
      // Professional font stack
      ctx.font = `${weight} ${fontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      
      // Minimal shadow for readability only (not glow)
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 1;
      ctx.shadowOffsetY = 1;
      
      ctx.fillStyle = color;
      ctx.fillText(text, xPos, yPos);
      
      // Measure text with current font to get accurate width
      const metrics = ctx.measureText(text);
      xPos += metrics.width + letterSpacing;
    }
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Draw suffix as superscript badge - professional styling
    if (suffix) {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      
      const suffixFontSize = 28;
      ctx.font = `500 ${suffixFontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      
      const suffixX = xPos + 10;
      const suffixY = yPos - fontSize * 0.35;
      const suffixMetrics = ctx.measureText(suffix);
      const bgPadding = 8;
      
      // Subtle badge background
      const badgeColor = logoColors ? logoColors.primary.hex : colors.primary;
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.roundRect(
        suffixX - bgPadding,
        suffixY - suffixFontSize / 2 - bgPadding / 2,
        suffixMetrics.width + bgPadding * 2,
        suffixFontSize + bgPadding,
        6
      );
      ctx.fill();
      
      // Badge text
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(suffix, suffixX, suffixY);
    }
    
    // Draw ticker with professional font
    const tickerFontSize = 36;
    ctx.font = `500 ${tickerFontSize}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = logoColors ? logoColors.secondary.hex : colors.secondary;
    ctx.shadowBlur = 0;
    ctx.fillText(`$${ticker}`, 400, height / 2 + 40);
    
    // Draw tagline if provided - thin, subtle
    if (tagline) {
      ctx.font = `300 ${22}px "Inter", "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = '#999999';
      ctx.fillText(tagline, 400, height / 2 + 85);
    }
    
    // Add contract address placeholder hint - subtle
    ctx.font = `300 ${16}px "SF Mono", "Monaco", "Consolas", monospace`;
    ctx.fillStyle = '#555555';
    ctx.fillText('solana • pump.fun', width - 200, height - 40);
    
    // Convert to buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Save to file
    const filename = `twitter-banner-${Date.now()}.png`;
    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    
    logger.success(`Twitter banner saved: ${filename}`);
    
    return {
      buffer,
      filepath,
      filename,
      icon: useAlphabetLogo ? `alphabet-${tokenName.charAt(0).toLowerCase()}` : (useShapeLogo ? `shape-${path.basename(shapeLogoPath, '.png')}` : icon),
      colorScheme,
      width,
      height,
      usedAlphabetLogo: useAlphabetLogo,
      usedShapeLogo: useShapeLogo,
    };
  }

  /**
   * Generate all branding assets at once
   */
  async generateAllAssets(tokenName, ticker, options = {}) {
    const {
      colorScheme = 'purple',
      tagline = null,
    } = options;

    logger.info(`Generating all branding assets for: ${tokenName} (${ticker})`);
    
    // Find best icon once (use same for all)
    const iconName = this.findBestIcon(tokenName);
    
    // Select logo ONCE and use the same for all assets
    const logoSelection = this.selectBestLogo(tokenName, colorScheme);
    logger.info(`Logo selection for all assets: alphabet=${!!logoSelection.alphabetLogoPath}, shape=${!!logoSelection.shapeLogoPath}`);
    
    // Generate all assets with the SAME logo selection
    const [tokenLogo, websiteLogo, twitterBanner] = await Promise.all([
      this.generateTokenLogo(tokenName, { colorScheme, iconName, logoSelection }),
      this.generateWebsiteLogo(tokenName, ticker, { colorScheme, iconName, logoSelection }),
      this.generateTwitterBanner(tokenName, ticker, { colorScheme, iconName, tagline, logoSelection }),
    ]);
    
    logger.success(`All assets generated for ${tokenName}!`);
    
    return {
      tokenLogo,
      websiteLogo,
      twitterBanner,
      icon: iconName,
      colorScheme,
    };
  }

  /**
   * Upload asset to Vercel Blob (if configured)
   */
  async uploadToVercelBlob(buffer, filename) {
    const config = getConfig();
    
    if (!config.vercel.token) {
      logger.warn('Vercel token not configured, skipping upload');
      return null;
    }

    try {
      const response = await fetch('https://blob.vercel-storage.com/' + filename, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${config.vercel.token}`,
          'Content-Type': 'image/png',
          'x-api-version': '7',
        },
        body: buffer,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      logger.success(`Uploaded to Vercel Blob: ${result.url}`);
      return result.url;
    } catch (error) {
      logger.error(`Failed to upload to Vercel Blob: ${error.message}`);
      return null;
    }
  }

  /**
   * List available icons
   */
  listIcons() {
    const icons = fs.readdirSync(this.iconsDir)
      .filter(f => f.endsWith('.svg'))
      .map(f => f.replace('.svg', ''));
    
    return icons;
  }

  /**
   * List available color schemes
   */
  listColorSchemes() {
    return Object.keys(COLOR_SCHEMES);
  }
}

module.exports = BrandingGenerator;
