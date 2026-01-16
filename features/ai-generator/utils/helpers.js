/**
 * Utility helper functions
 */

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    onRetry = () => {},
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }

      onRetry(error, attempt, delay);
      await sleep(delay);
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Generate domain name suggestions from token name
 */
function generateDomainSuggestions(tokenName, tlds = ['.xyz', '.fun', '.io', '.com']) {
  // Clean and normalize the name
  const cleaned = tokenName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
  
  // Generate variations
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  const variations = new Set();
  
  // Base name (no spaces)
  const base = words.join('');
  variations.add(base);
  
  // With dashes
  if (words.length > 1) {
    variations.add(words.join('-'));
  }
  
  // Common suffixes
  const suffixes = ['token', 'coin', 'sol', 'io', 'app', 'ai', 'fi'];
  suffixes.forEach(suffix => {
    if (!base.endsWith(suffix)) {
      variations.add(base + suffix);
    }
  });
  
  // Common prefixes
  const prefixes = ['get', 'the', 'buy', 'my'];
  prefixes.forEach(prefix => {
    if (!base.startsWith(prefix)) {
      variations.add(prefix + base);
    }
  });
  
  // First word only (for long names)
  if (words.length > 1 && words[0].length >= 4) {
    variations.add(words[0]);
  }
  
  // Generate all TLD combinations
  const domains = [];
  variations.forEach(name => {
    // Only valid domain names (3-63 chars, alphanumeric + hyphens)
    if (name.length >= 3 && name.length <= 63 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
      tlds.forEach(tld => {
        domains.push(name + tld);
      });
    }
  });
  
  return domains;
}

/**
 * Validate a domain name format
 */
function isValidDomain(domain) {
  const domainRegex = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?\.[a-z]{2,}$/i;
  return domainRegex.test(domain);
}

/**
 * Extract domain parts
 */
function parseDomain(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  
  const tld = '.' + parts.pop();
  const name = parts.join('.');
  
  return { name, tld, full: domain };
}

/**
 * Format price in USD
 */
function formatPrice(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Generate a simple slug from text
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check if a URL is accessible
 */
async function checkUrl(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = {
  sleep,
  retry,
  generateDomainSuggestions,
  isValidDomain,
  parseDomain,
  formatPrice,
  formatDuration,
  slugify,
  checkUrl,
};
