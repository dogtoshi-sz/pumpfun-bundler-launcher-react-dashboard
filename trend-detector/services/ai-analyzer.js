/**
 * AI Narrative Analyzer
 * Uses OpenAI to analyze trending tokens and identify patterns/narratives
 */

const axios = require('axios');

// Get OpenAI API key from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

class AIAnalyzer {
  constructor(trendDetector) {
    this.trendDetector = trendDetector;
    this.analysisInterval = null;
    this.lastAnalysis = null;
    this.lastAnalysisTime = 0;
    this.analysisHistory = [];
    this.maxHistoryLength = 20;
    
    // Rate limiting
    this.minAnalysisInterval = 20000; // 20 seconds minimum between analyses
    
    console.log('[AIAnalyzer] Service initialized');
    if (!OPENAI_API_KEY) {
      console.warn('[AIAnalyzer] ⚠️ No OPENAI_API_KEY found - AI analysis disabled');
    } else {
      console.log('[AIAnalyzer] ✅ OpenAI API key found');
    }
  }

  /**
   * Start periodic analysis
   */
  start(intervalMs = 30000) {
    if (!OPENAI_API_KEY) {
      console.warn('[AIAnalyzer] Cannot start - no API key');
      return;
    }
    
    if (this.analysisInterval) return;
    
    // Initial analysis after 10 seconds
    setTimeout(() => this.analyze(), 10000);
    
    // Then every intervalMs
    this.analysisInterval = setInterval(() => this.analyze(), intervalMs);
    
    console.log(`[AIAnalyzer] 🧠 Started - analyzing every ${intervalMs / 1000}s`);
  }

  /**
   * Stop analysis
   */
  stop() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    console.log('[AIAnalyzer] Stopped');
  }

  /**
   * Analyze current tokens and identify patterns
   */
  async analyze() {
    if (!OPENAI_API_KEY) return null;
    
    // Rate limit check
    const now = Date.now();
    if (now - this.lastAnalysisTime < this.minAnalysisInterval) {
      return this.lastAnalysis;
    }
    
    try {
      // Get current candidates and tracked tokens
      const candidates = this.trendDetector?.getCandidates() || [];
      const allTokens = this.trendDetector?.getTrackedTokens() || [];
      
      if (allTokens.length === 0) {
        console.log('[AIAnalyzer] No tokens to analyze');
        return null;
      }
      
      // Prepare token data for analysis
      const tokenSummaries = allTokens
        .filter(t => t.status !== 'dropped')
        .slice(0, 30) // Limit to top 30 for cost
        .map(t => ({
          name: t.name,
          symbol: t.symbol,
          score: t.score || 0,
          buyers: t.uniqueBuyers || 0,
          volume: (t.solVolume || 0).toFixed(2),
          status: t.status,
          hasImage: !!t.imageUrl,
        }));
      
      if (tokenSummaries.length === 0) {
        return null;
      }
      
      console.log(`[AIAnalyzer] 🧠 Analyzing ${tokenSummaries.length} tokens...`);
      
      // Call OpenAI
      const analysis = await this.callOpenAI(tokenSummaries, candidates.length);
      
      if (analysis) {
        this.lastAnalysis = {
          ...analysis,
          timestamp: now,
          tokenCount: tokenSummaries.length,
          candidateCount: candidates.length,
        };
        this.lastAnalysisTime = now;
        
        // Store in history
        this.analysisHistory.push(this.lastAnalysis);
        if (this.analysisHistory.length > this.maxHistoryLength) {
          this.analysisHistory.shift();
        }
        
        console.log('[AIAnalyzer] ✅ Analysis complete:', analysis.summary?.slice(0, 100) + '...');
      }
      
      return this.lastAnalysis;
      
    } catch (error) {
      console.error('[AIAnalyzer] Analysis error:', error.message);
      return null;
    }
  }

  /**
   * Analyze token images (for top candidates only - expensive!)
   */
  async analyzeImages(tokens) {
    if (!OPENAI_API_KEY) return null;
    
    // Only analyze top 5 candidates with images (cost control)
    const tokensWithImages = tokens
      .filter(t => t.imageUrl && t.status === 'candidate')
      .slice(0, 5);
    
    if (tokensWithImages.length === 0) {
      return null;
    }
    
    try {
      console.log(`[AIAnalyzer] 🖼️ Analyzing ${tokensWithImages.length} token images...`);
      
      const imageAnalysis = await this.callOpenAIVision(tokensWithImages);
      return imageAnalysis;
      
    } catch (error) {
      console.error('[AIAnalyzer] Image analysis error:', error.message);
      return null;
    }
  }

  /**
   * Call OpenAI API for text analysis
   */
  async callOpenAI(tokens, candidateCount) {
    const tokenList = tokens.map(t => 
      `- ${t.symbol} (${t.name}): score=${t.score}, buyers=${t.buyers}, vol=${t.volume}SOL, status=${t.status}`
    ).join('\n');
    
    const prompt = `You are a crypto trend analyst monitoring pump.fun token launches in real-time.

Current tokens being tracked (${tokens.length} tokens, ${candidateCount} candidates):
${tokenList}

Analyze these tokens and provide:
1. **NARRATIVES**: What themes/narratives are forming? (AI, memes, celebrities, animals, politics, etc.)
2. **HOT PATTERNS**: Any naming patterns trending right now?
3. **TOP PICKS**: Which 1-3 tokens look most promising based on the data and narrative strength?
4. **WARNINGS**: Any red flags or tokens to avoid?
5. **META INSIGHT**: What type of tokens are getting the most traction right now?

Be concise and actionable. Focus on patterns that could indicate what's hot RIGHT NOW.

Respond in JSON format:
{
  "narratives": ["narrative1", "narrative2"],
  "hotPatterns": ["pattern1", "pattern2"],
  "topPicks": [{"symbol": "XXX", "reason": "why"}],
  "warnings": ["warning1"],
  "metaInsight": "one sentence insight",
  "summary": "2-3 sentence executive summary"
}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a crypto trend analyst. Always respond with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const content = response.data.choices[0]?.message?.content;
    if (!content) return null;
    
    // Parse JSON response
    try {
      // Remove markdown code blocks if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('[AIAnalyzer] Failed to parse response:', content);
      return { summary: content, parseError: true };
    }
  }

  /**
   * Call OpenAI Vision API for image analysis
   */
  async callOpenAIVision(tokens) {
    const imageMessages = tokens.map(t => ({
      type: 'image_url',
      image_url: { url: t.imageUrl, detail: 'low' }
    }));
    
    const tokenInfo = tokens.map(t => `${t.symbol}: ${t.name}`).join(', ');
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'user', 
          content: [
            { 
              type: 'text', 
              text: `Analyze these ${tokens.length} pump.fun token logos (${tokenInfo}). 
              
What visual patterns do you see? Are they:
- Professional or amateur?
- Following any meme trends?
- Similar to successful tokens?
- Red flags (stolen art, low effort)?

Respond in JSON: {"imagePatterns": ["pattern1"], "quality": "high/medium/low", "concerns": ["any"], "insight": "one sentence"}`
            },
            ...imageMessages
          ]
        }
      ],
      temperature: 0.5,
      max_tokens: 300,
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const content = response.data.choices[0]?.message?.content;
    if (!content) return null;
    
    try {
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      return { insight: content, parseError: true };
    }
  }

  /**
   * Get latest analysis
   */
  getLatestAnalysis() {
    return this.lastAnalysis;
  }

  /**
   * Get analysis history
   */
  getHistory() {
    return this.analysisHistory;
  }

  /**
   * Force an immediate analysis
   */
  async forceAnalyze() {
    this.lastAnalysisTime = 0; // Reset rate limit
    return await this.analyze();
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      enabled: !!OPENAI_API_KEY,
      running: !!this.analysisInterval,
      lastAnalysisTime: this.lastAnalysisTime,
      analysisCount: this.analysisHistory.length,
      hasLatestAnalysis: !!this.lastAnalysis,
    };
  }
}

module.exports = { AIAnalyzer };
