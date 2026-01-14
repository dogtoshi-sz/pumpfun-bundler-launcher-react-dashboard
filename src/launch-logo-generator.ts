/**
 * Launch Logo Generator - Creates logos for token launches
 * 
 * Generates three types of logos:
 * 1. Token Logo - For the token itself (512x512)
 * 2. Website Logo - Transparent logo with text (for website headers)
 * 3. Twitter Banner - Banner image for Twitter (1500x500)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LaunchLogoOptions {
  tokenName: string;
  tokenSymbol: string;
  baseLogoPath?: string;
  alphabetLogo?: string;
  fontPath?: string;
  fontFamily?: string;
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
}

export interface LaunchLogos {
  tokenLogo: string;
  websiteLogo: string;
  twitterBanner: string;
}

/**
 * Get alphabet logo path based on first letter of token name or symbol
 */
export function getAlphabetLogoPath(letter: string, alphabetDir?: string): string | null {
  const dir = alphabetDir || path.join(process.cwd(), 'image', 'logo-library', 'Alphabet');
  const normalizedLetter = letter.toLowerCase().charAt(0);
  const logoPath = path.join(dir, `${normalizedLetter}.png`);
  
  if (fs.existsSync(logoPath)) {
    return logoPath;
  }
  
  return null;
}

/**
 * Generate token logo (512x512) - for pump.fun token creation
 */
export async function generateTokenLogo(
  options: LaunchLogoOptions,
  outputDir: string
): Promise<string> {
  let alphabetLogo: string | null = null;
  if (options.alphabetLogo) {
    alphabetLogo = getAlphabetLogoPath(options.alphabetLogo, undefined);
  } else {
    const nameLogo = getAlphabetLogoPath(options.tokenName, undefined);
    const symbolLogo = getAlphabetLogoPath(options.tokenSymbol, undefined);
    alphabetLogo = nameLogo || symbolLogo;
  }
  
  const baseLogo: string | undefined = options.baseLogoPath || alphabetLogo || undefined;
  
  const outputPath = path.join(outputDir, `token-logo-${Date.now()}.png`);
  const logoGen = await import('./simple-logo-generator');
  const { generateAndSaveSimpleLogo } = logoGen;
  
  const logoOptions: any = {
    tokenName: options.tokenName,
    tokenSymbol: options.tokenSymbol,
    baseLogoPath: baseLogo,
    fontPath: options.fontPath,
    fontFamily: options.fontFamily || 'Arial',
    fontSize: 60,
    textColor: options.primaryColor || '#FFFFFF',
    backgroundColor: options.backgroundColor || '#000000',
    width: 512,
    height: 512,
    textPosition: 'center',
    logoScale: 0.5
  };
  
  await generateAndSaveSimpleLogo(logoOptions, outputPath);
  
  return outputPath;
}

/**
 * Generate website logo (transparent background with text) - for website headers
 */
export async function generateWebsiteLogo(
  options: LaunchLogoOptions,
  outputDir: string
): Promise<string> {
  let alphabetLogo: string | null = null;
  if (options.alphabetLogo) {
    alphabetLogo = getAlphabetLogoPath(options.alphabetLogo, undefined);
  } else {
    const nameLogo = getAlphabetLogoPath(options.tokenName, undefined);
    const symbolLogo = getAlphabetLogoPath(options.tokenSymbol, undefined);
    alphabetLogo = nameLogo || symbolLogo;
  }
  
  const baseLogo: string | undefined = options.baseLogoPath || alphabetLogo || undefined;
  
  const outputPath = path.join(outputDir, `website-logo-${Date.now()}.png`);
  const logoGen = await import('./simple-logo-generator');
  const { generateAndSaveSimpleLogo } = logoGen;
  
  const logoOptions: any = {
    tokenName: options.tokenName,
    tokenSymbol: options.tokenSymbol,
    baseLogoPath: baseLogo,
    fontPath: options.fontPath,
    fontFamily: options.fontFamily || 'Arial',
    fontSize: 48,
    textColor: options.primaryColor || '#FFFFFF',
    backgroundColor: '#FFFFFF', // White background for website
    width: 400,
    height: 200,
    textPosition: 'center',
    logoScale: 0.4
  };
  
  await generateAndSaveSimpleLogo(logoOptions, outputPath);
  
  return outputPath;
}

/**
 * Generate Twitter banner (1500x500) - for Twitter profile banner
 */
export async function generateTwitterBanner(
  options: LaunchLogoOptions,
  outputDir: string
): Promise<string> {
  let alphabetLogo: string | null = null;
  if (options.alphabetLogo) {
    alphabetLogo = getAlphabetLogoPath(options.alphabetLogo, undefined);
  } else {
    const nameLogo = getAlphabetLogoPath(options.tokenName, undefined);
    const symbolLogo = getAlphabetLogoPath(options.tokenSymbol, undefined);
    alphabetLogo = nameLogo || symbolLogo;
  }
  
  const baseLogo: string | undefined = options.baseLogoPath || alphabetLogo || undefined;
  
  const outputPath = path.join(outputDir, `twitter-banner-${Date.now()}.png`);
  const logoGen = await import('./simple-logo-generator');
  const { generateAndSaveSimpleLogo } = logoGen;
  
  const logoOptions: any = {
    tokenName: options.tokenName,
    tokenSymbol: options.tokenSymbol,
    baseLogoPath: baseLogo,
    fontPath: options.fontPath,
    fontFamily: options.fontFamily || 'Arial',
    fontSize: 80,
    textColor: options.primaryColor || '#FFFFFF',
    backgroundColor: options.backgroundColor || '#000000',
    width: 1500,
    height: 500,
    textPosition: 'center',
    logoScale: 0.3
  };
  
  await generateAndSaveSimpleLogo(logoOptions, outputPath);
  
  return outputPath;
}

/**
 * Generate all three logos for a launch
 */
export async function generateLaunchLogos(
  options: LaunchLogoOptions,
  outputDir?: string
): Promise<LaunchLogos> {
  const dir = outputDir || path.join(process.cwd(), 'image', 'createdlogos');
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const [tokenLogo, websiteLogo, twitterBanner] = await Promise.all([
    generateTokenLogo(options, dir),
    generateWebsiteLogo(options, dir),
    generateTwitterBanner(options, dir)
  ]);
  
  return {
    tokenLogo,
    websiteLogo,
    twitterBanner
  };
}

/**
 * List available alphabet logos
 */
export function listAlphabetLogos(alphabetDir?: string): string[] {
  const dir = alphabetDir || path.join(process.cwd(), 'image', 'logo-library', 'Alphabet');
  
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files = fs.readdirSync(dir)
    .filter(f => f.match(/^[a-z]\.png$/i))
    .map(f => f.replace('.png', '').toLowerCase())
    .sort();
  
  return files;
}
