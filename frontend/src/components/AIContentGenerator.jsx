import { useState, useEffect } from 'react';
import {
  SparklesIcon,
  ArrowPathIcon,
  CheckIcon,
  XMarkIcon,
  ChevronDownIcon,
  LightBulbIcon,
  SwatchIcon,
  DocumentTextIcon,
  HashtagIcon,
  ChatBubbleBottomCenterTextIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  CpuChipIcon,
  BeakerIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { SparklesIcon as SparklesIconSolid } from '@heroicons/react/24/solid';
import apiService from '../services/api';

// Color scheme preview component
const ColorSchemePreview = ({ scheme, selected, onClick }) => (
  <button
    onClick={() => onClick(scheme.id)}
    className={`
      flex items-center gap-2 p-2 rounded-lg border transition-all
      ${selected 
        ? 'border-blue-500 bg-blue-500/10' 
        : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'}
    `}
  >
    <div 
      className="w-6 h-6 rounded-full border border-gray-600"
      style={{ background: `linear-gradient(135deg, ${scheme.primary}, ${scheme.secondary})` }}
    />
    <span className="text-xs text-gray-300">{scheme.name}</span>
    {selected && <CheckIcon className="w-3 h-3 text-blue-400 ml-auto" />}
  </button>
);

// Prompt suggestion pills
const PromptSuggestion = ({ text, onClick }) => (
  <button
    onClick={() => onClick(text)}
    className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded-full 
               hover:bg-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-200 transition-all"
  >
    {text}
  </button>
);

export default function AIContentGenerator({ onApply, currentSettings = {} }) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [colorSchemes, setColorSchemes] = useState([]);
  const [selectedColorScheme, setSelectedColorScheme] = useState(null);
  const [aiStatus, setAIStatus] = useState(null);
  const [error, setError] = useState(null);
  const [showVariations, setShowVariations] = useState(false);
  const [variations, setVariations] = useState([]);
  const [selectedVariation, setSelectedVariation] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [generateImages, setGenerateImages] = useState(true);
  const [brandingResult, setBrandingResult] = useState(null);
  const [applySuccess, setApplySuccess] = useState(false);

  // Load color schemes and AI status on mount
  useEffect(() => {
    loadColorSchemes();
    checkAIStatus();
  }, []);

  const loadColorSchemes = async () => {
    try {
      const response = await apiService.getAIColorSchemes();
      if (response.data.success) {
        setColorSchemes(response.data.schemes);
      }
    } catch (err) {
      console.error('Failed to load color schemes:', err);
    }
  };

  const checkAIStatus = async () => {
    try {
      const response = await apiService.getAIStatus();
      setAIStatus(response.data);
    } catch (err) {
      console.error('Failed to check AI status:', err);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setGenerating(true);
    setError(null);
    setGeneratedContent(null);
    setBrandingResult(null);

    try {
      const response = await apiService.generateAIContent(prompt, {
        theme: selectedColorScheme,
        forceTemplate: false,
        generateImages: generateImages,
        uploadImages: true,
      });

      if (response.data.success) {
        setGeneratedContent(response.data.data);
        if (response.data.branding) {
          setBrandingResult(response.data.branding);
        }
        setIsExpanded(true);
      } else {
        setError(response.data.error || 'Generation failed');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateVariations = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setGenerating(true);
    setError(null);
    setVariations([]);
    setBrandingResult(null);

    try {
      const response = await apiService.generateAIVariations(prompt, 3, {
        theme: selectedColorScheme,
        generateImages: generateImages,
        uploadImages: true,
      });

      if (response.data.success && response.data.variations.length > 0) {
        // Each variation may have its own branding
        const variationsWithBranding = response.data.variations.map((v, i) => ({
          ...v,
          branding: response.data.brandingResults?.[i] || null,
        }));
        setVariations(variationsWithBranding);
        setGeneratedContent(variationsWithBranding[0]);
        if (variationsWithBranding[0].branding) {
          setBrandingResult(variationsWithBranding[0].branding);
        }
        setSelectedVariation(0);
        setShowVariations(true);
        setIsExpanded(true);
      } else {
        setError('Failed to generate variations');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectVariation = (index) => {
    setSelectedVariation(index);
    setGeneratedContent(variations[index]);
    // Also switch branding result for this variation
    if (variations[index]?.branding) {
      setBrandingResult(variations[index].branding);
    } else {
      setBrandingResult(null);
    }
  };

  const handleApply = () => {
    if (generatedContent && onApply) {
      // Generate social handles from token name
      const handle = generatedContent.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 15);

      // Apply all .env fields
      const applyData = {
        TOKEN_NAME: generatedContent.name,
        TOKEN_SYMBOL: generatedContent.ticker,
        DESCRIPTION: generatedContent.description,
        TOKEN_SHOW_NAME: generatedContent.name,
        // Generate placeholder socials based on name
        TWITTER: `https://x.com/${handle}_sol`,
        TELEGRAM: `https://t.me/${handle}_sol`,
        WEBSITE: `https://${handle}.xyz`,
      };

      // Include branding URLs if available
      if (brandingResult?.uploaded) {
        console.log('[AI] Applying branding URLs:', brandingResult);
        if (brandingResult.tokenLogoUrl) {
          applyData.FILE = brandingResult.tokenLogoUrl;
        }
        if (brandingResult.websiteLogoUrl) {
          applyData.WEBSITE_LOGO = brandingResult.websiteLogoUrl;
        }
      } else {
        console.log('[AI] No branding URLs to apply, brandingResult:', brandingResult);
      }

      console.log('[AI] Applying settings:', applyData);
      onApply(applyData);
      
      // Show success feedback
      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 2000);
    }
  };

  const handleApplyField = (field, value) => {
    if (onApply) {
      const fieldMap = {
        name: 'TOKEN_NAME',
        ticker: 'TOKEN_SYMBOL',
        description: 'DESCRIPTION',
      };
      onApply({ [fieldMap[field] || field]: value });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const promptSuggestions = [
    'dog meme coin',
    'AI trading bot',
    'casino wagering',
    'frog meme',
    'space exploration',
    'gaming token',
    'DeFi yield',
  ];

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg">
            <SparklesIconSolid className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              AI Content Generator
              {aiStatus?.openaiAvailable && (
                <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">
                  GPT-4
                </span>
              )}
              {aiStatus && !aiStatus.openaiAvailable && (
                <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
                  Template
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500">Generate token names, descriptions & branding with AI</p>
          </div>
        </div>
        <ChevronDownIcon 
          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* AI Status Warning */}
          {aiStatus && !aiStatus.openaiAvailable && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="text-yellow-400 font-medium">Using Template Fallback</p>
                <p className="text-yellow-400/70">
                  Add <code className="px-1 bg-gray-800 rounded">OPENAI_API_KEY</code> to .env for AI-powered generation
                </p>
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Describe your token idea
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., A wagering platform for crypto enthusiasts, a cute dog meme coin, an AI-powered trading bot..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white 
                         placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                rows={2}
              />
              {prompt && (
                <button
                  onClick={() => setPrompt('')}
                  className="absolute top-2 right-2 p-1 text-gray-500 hover:text-gray-300"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            
            {/* Suggestions */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {promptSuggestions.map((suggestion) => (
                <PromptSuggestion
                  key={suggestion}
                  text={suggestion}
                  onClick={(text) => setPrompt(text)}
                />
              ))}
            </div>
          </div>

          {/* Color Scheme Selection */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2 flex items-center gap-1">
              <SwatchIcon className="w-3 h-3" />
              Color Scheme (optional)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {colorSchemes.slice(0, 6).map((scheme) => (
                <ColorSchemePreview
                  key={scheme.id}
                  scheme={scheme}
                  selected={selectedColorScheme === scheme.id}
                  onClick={setSelectedColorScheme}
                />
              ))}
            </div>
            {colorSchemes.length > 6 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {colorSchemes.slice(6).map((scheme) => (
                  <ColorSchemePreview
                    key={scheme.id}
                    scheme={scheme}
                    selected={selectedColorScheme === scheme.id}
                    onClick={setSelectedColorScheme}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Generate Images Toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2">
              <PhotoIcon className="w-4 h-4 text-pink-400" />
              <div>
                <span className="text-sm text-white">Generate Branding Images</span>
                <p className="text-xs text-gray-500">Logo, website logo & Twitter banner</p>
              </div>
            </div>
            <button
              onClick={() => setGenerateImages(!generateImages)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                generateImages ? 'bg-pink-600' : 'bg-gray-600'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                generateImages ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* Generate Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 
                       bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       rounded-lg text-sm font-medium text-white transition-all"
            >
              {generating ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <SparklesIcon className="w-4 h-4" />
              )}
              Generate
            </button>
            <button
              onClick={handleGenerateVariations}
              disabled={generating || !prompt.trim()}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700
                       disabled:opacity-50 disabled:cursor-not-allowed
                       border border-gray-700 rounded-lg text-sm text-gray-300 transition-all"
            >
              <BeakerIcon className="w-4 h-4" />
              3 Variations
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <XMarkIcon className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Generated Content */}
          {generatedContent && (
            <div className="space-y-3 pt-3 border-t border-gray-800">
              {/* Variation Cards - Token Preview Style */}
              {showVariations && variations.length > 1 && (
                <div className="space-y-2 mb-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Select a variation:</div>
                  <div className="grid grid-cols-1 gap-2">
                    {variations.map((variation, index) => {
                      // Generate social handles from name
                      const handle = variation.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
                      
                      return (
                        <button
                          key={index}
                          onClick={() => handleSelectVariation(index)}
                          className={`relative p-3 rounded-lg border transition-all text-left
                            ${selectedVariation === index 
                              ? 'bg-purple-600/20 border-purple-500 ring-1 ring-purple-500/50' 
                              : 'bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800'}`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Token Logo Preview */}
                            {variation.branding?.tokenLogoUrl ? (
                              <img 
                                src={variation.branding.tokenLogoUrl}
                                alt={variation.name}
                                className="w-14 h-14 rounded-lg object-cover border border-gray-700 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-purple-600/30 to-pink-600/30 border border-gray-700 flex items-center justify-center flex-shrink-0">
                                <SparklesIcon className="w-6 h-6 text-purple-400" />
                              </div>
                            )}
                            
                            {/* Token Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-white truncate">{variation.name}</span>
                                <span className="text-xs text-gray-400 font-mono">${variation.ticker}</span>
                                {selectedVariation === index && (
                                  <CheckIcon className="w-4 h-4 text-purple-400 ml-auto flex-shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-gray-400 line-clamp-1 mb-1.5">{variation.description}</p>
                              
                              {/* Generated Links */}
                              <div className="flex flex-wrap gap-1.5 text-[10px]">
                                <span className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400">
                                  🌐 {handle}.xyz
                                </span>
                                <span className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400">
                                  𝕏 @{handle}_sol
                                </span>
                                <span className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400">
                                  📱 t.me/{handle}_sol
                                </span>
                              </div>
                              
                              {/* Image previews row */}
                              {(variation.branding?.uploaded || variation.branding?.tokenLogoUrl) && (
                                <div className="flex items-center gap-2 mt-2">
                                  {variation.branding.tokenLogoUrl && (
                                    <div className="relative group/img">
                                      <img 
                                        src={variation.branding.tokenLogoUrl}
                                        alt="Token"
                                        className={`w-8 h-8 rounded object-cover border ${variation.branding.aiGenerated ? 'border-purple-500' : 'border-gray-600'}`}
                                      />
                                      <span className="absolute -bottom-4 left-0 text-[8px] text-gray-500 opacity-0 group-hover/img:opacity-100">
                                        {variation.branding.aiGenerated ? 'AI' : 'Token'}
                                      </span>
                                    </div>
                                  )}
                                  {variation.branding.websiteLogoUrl && (
                                    <div className="relative group/img">
                                      <img 
                                        src={variation.branding.websiteLogoUrl}
                                        alt="Website"
                                        className="w-8 h-8 rounded object-contain bg-gray-900 border border-gray-600"
                                      />
                                      <span className="absolute -bottom-4 left-0 text-[8px] text-gray-500 opacity-0 group-hover/img:opacity-100">Web</span>
                                    </div>
                                  )}
                                  {variation.branding.twitterBannerUrl && (
                                    <div className="relative group/img">
                                      <img 
                                        src={variation.branding.twitterBannerUrl}
                                        alt="Banner"
                                        className="w-16 h-8 rounded object-cover border border-gray-600"
                                      />
                                      <span className="absolute -bottom-4 left-0 text-[8px] text-gray-500 opacity-0 group-hover/img:opacity-100">Banner</span>
                                    </div>
                                  )}
                                  {variation.branding.aiGenerated && (
                                    <span className="text-[10px] text-purple-400 ml-1">🤖 AI</span>
                                  )}
                                  <span className="text-[10px] text-green-400 ml-1">✓ Ready</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Option badge */}
                          <div className="absolute top-2 right-2">
                            <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                              selectedVariation === index 
                                ? 'bg-purple-500 text-white' 
                                : 'bg-gray-700 text-gray-400'
                            }`}>
                              #{index + 1}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Name */}
              <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg group">
                <LightBulbIcon className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Name</div>
                  <div className="text-sm text-white font-medium">{generatedContent.name}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyToClipboard(generatedContent.name)}
                    className="p-1 text-gray-500 hover:text-gray-300"
                    title="Copy"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleApplyField('name', generatedContent.name)}
                    className="p-1 text-green-500 hover:text-green-400"
                    title="Apply"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Ticker */}
              <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg group">
                <HashtagIcon className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Ticker</div>
                  <div className="text-sm text-white font-mono">${generatedContent.ticker}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyToClipboard(generatedContent.ticker)}
                    className="p-1 text-gray-500 hover:text-gray-300"
                    title="Copy"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleApplyField('ticker', generatedContent.ticker)}
                    className="p-1 text-green-500 hover:text-green-400"
                    title="Apply"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tagline */}
              {generatedContent.tagline && (
                <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg group">
                  <ChatBubbleBottomCenterTextIcon className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Tagline</div>
                    <div className="text-sm text-gray-300 italic">"{generatedContent.tagline}"</div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(generatedContent.tagline)}
                    className="p-1 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copy"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Description */}
              <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg group">
                <DocumentTextIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Description</div>
                  <div className="text-sm text-gray-300">{generatedContent.description}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyToClipboard(generatedContent.description)}
                    className="p-1 text-gray-500 hover:text-gray-300"
                    title="Copy"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleApplyField('description', generatedContent.description)}
                    className="p-1 text-green-500 hover:text-green-400"
                    title="Apply"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Color Scheme */}
              {generatedContent.colorScheme && (
                <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <SwatchIcon className="w-4 h-4 text-pink-400 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Suggested Color</div>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full border border-gray-600"
                        style={{ 
                          background: colorSchemes.find(s => s.id === generatedContent.colorScheme)
                            ? `linear-gradient(135deg, ${colorSchemes.find(s => s.id === generatedContent.colorScheme).primary}, ${colorSchemes.find(s => s.id === generatedContent.colorScheme).secondary})`
                            : '#9945FF'
                        }}
                      />
                      <span className="text-sm text-gray-300 capitalize">{generatedContent.colorScheme}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Generated Social Links */}
              {generatedContent.name && (
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Generated Links</div>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const handle = generatedContent.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
                      return (
                        <>
                          <a 
                            href={`https://${handle}.xyz`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-xs text-gray-300 hover:text-white transition-colors"
                          >
                            🌐 <span>{handle}.xyz</span>
                          </a>
                          <a 
                            href={`https://x.com/${handle}_sol`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-xs text-gray-300 hover:text-white transition-colors"
                          >
                            𝕏 <span>@{handle}_sol</span>
                          </a>
                          <a 
                            href={`https://t.me/${handle}_sol`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-xs text-gray-300 hover:text-white transition-colors"
                          >
                            📱 <span>t.me/{handle}_sol</span>
                          </a>
                          <button
                            onClick={() => {
                              copyToClipboard(`https://${handle}.xyz`);
                            }}
                            className="p-1 text-gray-500 hover:text-gray-300"
                            title="Copy all links"
                          >
                            <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">
                    💡 These are placeholder links based on the token name. Update them after creating actual accounts.
                  </p>
                </div>
              )}

              {/* Generated Branding Images */}
              {brandingResult && (
                <div className="p-3 bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <PhotoIcon className="w-4 h-4 text-pink-400" />
                    <span className="text-sm font-medium text-white">Generated Branding</span>
                    {brandingResult.aiGenerated && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded flex items-center gap-1">
                        <LightBulbIcon className="w-3 h-3" />
                        Gemini AI
                      </span>
                    )}
                    {brandingResult.uploaded && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">
                        ✓ Uploaded
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {/* Token Logo */}
                    {(brandingResult.tokenLogoUrl || brandingResult.tokenLogo) && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Token Logo</div>
                        <a 
                          href={brandingResult.tokenLogoUrl || '#'} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img 
                            src={brandingResult.tokenLogoUrl || `/api/file?path=${encodeURIComponent(brandingResult.tokenLogo)}`}
                            alt="Token Logo"
                            className="w-full aspect-square object-cover rounded-lg border border-gray-700 hover:border-pink-500 transition-colors"
                          />
                        </a>
                      </div>
                    )}
                    
                    {/* Website Logo */}
                    {(brandingResult.websiteLogoUrl || brandingResult.websiteLogo) && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Website Logo</div>
                        <a 
                          href={brandingResult.websiteLogoUrl || '#'} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img 
                            src={brandingResult.websiteLogoUrl || `/api/file?path=${encodeURIComponent(brandingResult.websiteLogo)}`}
                            alt="Website Logo"
                            className="w-full aspect-square object-contain rounded-lg border border-gray-700 hover:border-pink-500 transition-colors bg-gray-900"
                          />
                        </a>
                      </div>
                    )}
                    
                    {/* Twitter Banner */}
                    {(brandingResult.twitterBannerUrl || brandingResult.twitterBanner) && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Twitter Banner</div>
                        <a 
                          href={brandingResult.twitterBannerUrl || '#'} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img 
                            src={brandingResult.twitterBannerUrl || `/api/file?path=${encodeURIComponent(brandingResult.twitterBanner)}`}
                            alt="Twitter Banner"
                            className="w-full aspect-[3/1] object-cover rounded-lg border border-gray-700 hover:border-pink-500 transition-colors"
                          />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Copy URLs */}
                  {brandingResult.uploaded && (
                    <div className="flex gap-2 mt-3">
                      {brandingResult.tokenLogoUrl && (
                        <button
                          onClick={() => copyToClipboard(brandingResult.tokenLogoUrl)}
                          className="flex-1 px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        >
                          Copy Token URL
                        </button>
                      )}
                      {brandingResult.websiteLogoUrl && (
                        <button
                          onClick={() => copyToClipboard(brandingResult.websiteLogoUrl)}
                          className="flex-1 px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        >
                          Copy Website URL
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Apply All Button */}
              <button
                onClick={handleApply}
                disabled={applySuccess}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 
                         rounded-lg text-sm font-medium text-white transition-all
                         ${applySuccess 
                           ? 'bg-green-500 cursor-default' 
                           : 'bg-green-600 hover:bg-green-500'}`}
              >
                <CheckIcon className="w-4 h-4" />
                {applySuccess ? '✓ Applied! Saving...' : 'Apply All to Token Settings'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
