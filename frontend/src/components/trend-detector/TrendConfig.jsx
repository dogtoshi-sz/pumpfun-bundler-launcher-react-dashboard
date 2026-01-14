import React, { useState } from 'react';
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';

export default function TrendConfig({ heuristics, onUpdate, onReset }) {
  const [expanded, setExpanded] = useState({
    aliveGate: true,
    conversionGate: false,
    scoring: false,
    tracking: false,
  });
  
  const [localChanges, setLocalChanges] = useState({});
  const [saving, setSaving] = useState(false);

  // Handle input change
  const handleChange = (section, key, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    setLocalChanges(prev => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [key]: numValue,
      },
    }));
  };

  // Save changes
  const handleSave = async () => {
    if (Object.keys(localChanges).length === 0) return;
    
    setSaving(true);
    await onUpdate(localChanges);
    setLocalChanges({});
    setSaving(false);
  };

  // Get current value (local change or heuristic)
  const getValue = (section, key) => {
    if (localChanges[section]?.[key] !== undefined) {
      return localChanges[section][key];
    }
    return heuristics[section]?.[key];
  };

  // Toggle section
  const toggleSection = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Section header component
  const SectionHeader = ({ title, section, description }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
    >
      <div className="text-left">
        <h4 className="font-medium text-white">{title}</h4>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {expanded[section] ? (
        <ChevronUpIcon className="w-5 h-5 text-gray-400" />
      ) : (
        <ChevronDownIcon className="w-5 h-5 text-gray-400" />
      )}
    </button>
  );

  // Number input component
  const NumberInput = ({ section, field, label, description, min = 0, max = 100, step = 1 }) => {
    const value = getValue(section, field);
    const isChanged = localChanges[section]?.[field] !== undefined;
    
    return (
      <div className="flex items-center justify-between py-2">
        <div className="flex-1">
          <label className="text-sm text-gray-300">{label}</label>
          {description && (
            <p className="text-xs text-gray-500">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(section, field, e.target.value)}
            min={min}
            max={max}
            step={step}
            className={`w-24 px-3 py-1.5 bg-gray-900 border rounded text-right text-white text-sm ${
              isChanged ? 'border-purple-500' : 'border-gray-700'
            }`}
          />
          {isChanged && (
            <span className="text-purple-400 text-xs">*</span>
          )}
        </div>
      </div>
    );
  };

  const hasChanges = Object.keys(localChanges).length > 0;

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AdjustmentsHorizontalIcon className="w-5 h-5 text-purple-400" />
          <h3 className="font-semibold text-white">Heuristics Configuration</h3>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded transition-colors disabled:opacity-50"
            >
              {saving ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <CheckIcon className="w-4 h-4" />
              )}
              Save Changes
            </button>
          )}
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Reset
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Alive Gate */}
        <div>
          <SectionHeader
            title="Alive Gate"
            section="aliveGate"
            description="Checked at 120 seconds - filters out dead tokens early"
          />
          {expanded.aliveGate && (
            <div className="mt-3 pl-4 border-l-2 border-purple-500/30 space-y-1">
              <NumberInput
                section="aliveGate"
                field="minUniqueBuyers"
                label="Min Unique Buyers"
                description="Minimum unique wallet addresses that bought"
                min={1}
                max={50}
              />
              <NumberInput
                section="aliveGate"
                field="minBuys"
                label="Min Total Buys"
                description="Minimum buy transactions"
                min={1}
                max={100}
              />
              <NumberInput
                section="aliveGate"
                field="minSolVolume"
                label="Min SOL Volume"
                description="Minimum SOL traded in first 2 minutes"
                min={0}
                max={100}
                step={0.1}
              />
              <NumberInput
                section="aliveGate"
                field="maxTimeToFirstBuy"
                label="Max Time to First Buy (s)"
                description="Organic tokens get bought fast"
                min={5}
                max={120}
              />
              <NumberInput
                section="aliveGate"
                field="maxTimeToSecondBuyer"
                label="Max Time to 2nd Buyer (s)"
                description="Quick second buyer = real interest"
                min={10}
                max={180}
              />
            </div>
          )}
        </div>

        {/* Conversion Gate */}
        <div>
          <SectionHeader
            title="Conversion Gate"
            section="conversionGate"
            description="Rolling check from 3-10 minutes - maintains momentum"
          />
          {expanded.conversionGate && (
            <div className="mt-3 pl-4 border-l-2 border-yellow-500/30 space-y-1">
              <NumberInput
                section="conversionGate"
                field="minNewBuyersLast2m"
                label="Min New Buyers (2m)"
                description="New buyers in rolling 2 min window"
                min={0}
                max={50}
              />
              <NumberInput
                section="conversionGate"
                field="minBuySellRatio"
                label="Min Buy/Sell Ratio"
                description="Buys/Sells must stay above this"
                min={0}
                max={5}
                step={0.1}
              />
              <NumberInput
                section="conversionGate"
                field="maxConsecutiveNegativeAccel"
                label="Max Negative Accel"
                description="Drop after N consecutive slowdowns"
                min={1}
                max={10}
              />
            </div>
          )}
        </div>

        {/* Scoring */}
        <div>
          <SectionHeader
            title="Scoring Weights"
            section="scoring"
            description="Adjust how the 0-100 momentum score is calculated"
          />
          {expanded.scoring && (
            <div className="mt-3 pl-4 border-l-2 border-green-500/30 space-y-1">
              <NumberInput
                section="scoring"
                field="buyersWeight"
                label="Buyers Weight"
                description="Score += buyers * weight"
                min={0}
                max={20}
              />
              <NumberInput
                section="scoring"
                field="buyersMax"
                label="Buyers Max Contribution"
                description="Cap buyer score at this"
                min={0}
                max={50}
              />
              <NumberInput
                section="scoring"
                field="tradesWeight"
                label="Trades Weight"
                description="Score += trades * weight"
                min={0}
                max={20}
              />
              <NumberInput
                section="scoring"
                field="volumeWeight"
                label="Volume Weight"
                description="Score += volume * weight"
                min={0}
                max={20}
              />
              <NumberInput
                section="scoring"
                field="ratioHighBonus"
                label="High Ratio Bonus"
                description="Bonus if B/S ratio > 1.8"
                min={0}
                max={30}
              />
              <NumberInput
                section="scoring"
                field="accelPositiveBonus"
                label="Acceleration Bonus"
                description="Bonus if momentum accelerating"
                min={0}
                max={30}
              />
            </div>
          )}
        </div>

        {/* Tracking */}
        <div>
          <SectionHeader
            title="Tracking Settings"
            section="tracking"
            description="How long and how often to track tokens"
          />
          {expanded.tracking && (
            <div className="mt-3 pl-4 border-l-2 border-blue-500/30 space-y-1">
              <NumberInput
                section="tracking"
                field="candidateCount"
                label="Candidate Count"
                description="Number of top candidates to show"
                min={5}
                max={50}
              />
              <NumberInput
                section="tracking"
                field="maxTrackedTokens"
                label="Max Tracked Tokens"
                description="Maximum tokens to track simultaneously"
                min={10}
                max={500}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
