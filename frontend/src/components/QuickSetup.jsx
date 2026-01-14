import React, { useState, useEffect } from 'react';
import {
  SparklesIcon,
  GlobeAltIcon,
  PhotoIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  MagnifyingGlassIcon,
  CurrencyDollarIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';

const API_BASE = 'http://localhost:3001';

export default function QuickSetup() {
  // State
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Form data
  const [tokenName, setTokenName] = useState('');
  const [colorScheme, setColorScheme] = useState('cyber');
  const [maxPrice, setMaxPrice] = useState(5);
  
  // Results
  const [vercelProjects, setVercelProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [domains, setDomains] = useState([]);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [branding, setBranding] = useState(null);
  const [purchaseResult, setPurchaseResult] = useState(null);

  // Color schemes
  const colorSchemes = [
    { id: 'cyber', name: 'Cyber Blue', color: '#00f0ff' },
    { id: 'neon', name: 'Neon Green', color: '#00ff88' },
    { id: 'purple', name: 'Purple', color: '#9945FF' },
    { id: 'gold', name: 'Gold', color: '#ffd700' },
    { id: 'pink', name: 'Pink', color: '#ff00ff' },
    { id: 'matrix', name: 'Matrix', color: '#00ff00' },
    { id: 'fire', name: 'Fire', color: '#ff4500' },
  ];

  // Load Vercel projects on mount
  useEffect(() => {
    loadVercelProjects();
  }, []);

  const loadVercelProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/setup/vercel-projects`);
      const data = await res.json();
      if (data.success) {
        setVercelProjects(data.projects);
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  };

  // Step 1: Enter name and search
  const handleSearch = async () => {
    if (!tokenName.trim()) {
      setError('Please enter a token/project name');
      return;
    }
    
    setLoading(true);
    setError(null);
    setDomains([]);
    setGeneratedContent(null);
    setBranding(null);
    
    try {
      // Full setup: search domains + generate content
      const res = await fetch(`${API_BASE}/api/setup/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tokenName,
          colorScheme,
          maxPrice,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setDomains(data.domains || []);
        setGeneratedContent(data.content);
        setBranding(data.branding);
        if (data.domains?.length > 0) {
          setSelectedDomain(data.domains[0]);
        }
        setStep(2);
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Purchase and connect
  const handlePurchase = async () => {
    if (!selectedDomain || !selectedProject) {
      setError('Please select a domain and project');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`${API_BASE}/api/setup/purchase-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: selectedDomain.domain,
          price: selectedDomain.price,
          projectId: selectedProject.id,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setPurchaseResult(data);
        setStep(4);
      } else {
        setError(data.error || 'Purchase failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="flex items-center gap-3 mb-6">
        <SparklesIcon className="w-6 h-6 text-purple-400" />
        <h2 className="text-xl font-bold text-white">Quick Setup</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
          Step {step} of 4
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded ${
              s <= step ? 'bg-purple-500' : 'bg-gray-700'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Step 1: Enter name */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Token / Project Name
            </label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g. Mitsui AI, CryptoBot, etc."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-purple-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Color Scheme
            </label>
            <div className="flex flex-wrap gap-2">
              {colorSchemes.map((scheme) => (
                <button
                  key={scheme.id}
                  onClick={() => setColorScheme(scheme.id)}
                  className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${
                    colorScheme === scheme.id
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: scheme.color }}
                  />
                  {scheme.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Max Domain Price: ${maxPrice}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="0.5"
              value={maxPrice}
              onChange={(e) => setMaxPrice(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={loading || !tokenName.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white py-3 rounded-lg flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="w-5 h-5" />
                Search Domains & Generate Content
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 2: Select domain */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-cyan-400" />
            Available Domains (under ${maxPrice})
          </h3>

          {domains.length === 0 ? (
            <div className="text-gray-400 text-center py-4">
              No domains found under ${maxPrice}. Try increasing the price limit.
            </div>
          ) : (
            <div className="grid gap-2">
              {domains.map((d) => (
                <button
                  key={d.domain}
                  onClick={() => setSelectedDomain(d)}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    selectedDomain?.domain === d.domain
                      ? 'bg-purple-600/30 border border-purple-500'
                      : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <span className="text-white font-medium">{d.domain}</span>
                  <span className="text-green-400 font-bold">{d.priceFormatted}</span>
                </button>
              ))}
            </div>
          )}

          {/* Preview generated content */}
          {generatedContent && (
            <div className="mt-4 p-4 bg-gray-800/50 rounded-lg">
              <h4 className="text-sm text-gray-400 mb-2">Generated Content Preview</h4>
              <div className="text-white font-bold">{generatedContent.name}</div>
              <div className="text-gray-400 text-sm">${generatedContent.ticker}</div>
              <div className="text-gray-500 text-xs mt-2">{generatedContent.description}</div>
            </div>
          )}

          {/* Preview logos */}
          {branding && (
            <div className="mt-4">
              <h4 className="text-sm text-gray-400 mb-2">Generated Logos</h4>
              <div className="flex gap-4">
                {branding.tokenLogoUrl && (
                  <img
                    src={branding.tokenLogoUrl}
                    alt="Token Logo"
                    className="w-16 h-16 rounded-lg bg-gray-800"
                  />
                )}
                {branding.websiteLogoUrl && (
                  <img
                    src={branding.websiteLogoUrl}
                    alt="Website Logo"
                    className="h-10 rounded bg-gray-800"
                  />
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!selectedDomain}
              className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white py-2 rounded-lg flex items-center justify-center gap-2"
            >
              Continue
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Select Vercel project */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <ServerIcon className="w-5 h-5 text-blue-400" />
            Connect to Vercel Project
          </h3>

          <div className="grid gap-2">
            {vercelProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProject(p)}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  selectedProject?.id === p.id
                    ? 'bg-purple-600/30 border border-purple-500'
                    : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
                }`}
              >
                <div>
                  <span className="text-white font-medium">{p.name}</span>
                  <span className="text-gray-500 text-xs ml-2">{p.url}</span>
                </div>
                {selectedProject?.id === p.id && (
                  <CheckCircleIcon className="w-5 h-5 text-purple-400" />
                )}
              </button>
            ))}
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 mt-4">
            <div className="text-sm text-gray-400 mb-2">Summary</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Domain:</span>
                <span className="text-white">{selectedDomain?.domain}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Price:</span>
                <span className="text-green-400">{selectedDomain?.priceFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Project:</span>
                <span className="text-white">{selectedProject?.name || 'Not selected'}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
            >
              Back
            </button>
            <button
              onClick={handlePurchase}
              disabled={loading || !selectedProject}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white py-2 rounded-lg flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Purchasing...
                </>
              ) : (
                <>
                  <CurrencyDollarIcon className="w-5 h-5" />
                  Purchase & Connect ({selectedDomain?.priceFormatted})
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Success */}
      {step === 4 && purchaseResult && (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircleIcon className="w-10 h-10 text-green-400" />
          </div>
          
          <h3 className="text-xl font-bold text-white">Setup Complete!</h3>
          
          <div className="bg-gray-800/50 rounded-lg p-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Domain:</span>
              <a
                href={purchaseResult.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:underline"
              >
                {purchaseResult.domain}
              </a>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order ID:</span>
              <span className="text-white font-mono text-xs">{purchaseResult.orderId}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Website URL:</span>
              <a
                href={purchaseResult.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline"
              >
                {purchaseResult.websiteUrl}
              </a>
            </div>
          </div>

          <p className="text-gray-400 text-sm">
            DNS propagation may take a few minutes. Your site should be live shortly!
          </p>

          <button
            onClick={() => {
              setStep(1);
              setTokenName('');
              setDomains([]);
              setSelectedDomain(null);
              setSelectedProject(null);
              setPurchaseResult(null);
            }}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
          >
            Set Up Another
          </button>
        </div>
      )}
    </div>
  );
}
