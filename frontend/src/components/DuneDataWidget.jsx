import { useState, useEffect } from 'react';
import { 
  ChartBarIcon, 
  XMarkIcon, 
  ClockIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import apiService from '../services/api';

// Common timezones
const TIMEZONES = [
  { value: 'UTC', label: 'UTC', offset: 0 },
  { value: 'America/New_York', label: 'EST (New York)', offset: -5 },
  { value: 'America/Los_Angeles', label: 'PST (Los Angeles)', offset: -8 },
  { value: 'America/Chicago', label: 'CST (Chicago)', offset: -6 },
  { value: 'Europe/London', label: 'GMT (London)', offset: 0 },
  { value: 'Europe/Berlin', label: 'CET (Berlin)', offset: 1 },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)', offset: 9 },
  { value: 'Asia/Singapore', label: 'SGT (Singapore)', offset: 8 },
];

export default function DuneDataWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [volumeData, setVolumeData] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [daysFilter, setDaysFilter] = useState(() => {
    return parseInt(localStorage.getItem('dune-days-filter')) || 7;
  });
  const [selectedTimezone, setSelectedTimezone] = useState(() => {
    return localStorage.getItem('dune-timezone') || 'America/Los_Angeles';
  });
  const [chartView, setChartView] = useState('avg'); // 'avg' = hourly average (24 bars), 'timeline' = all data points

  // Listen for open event from footer
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-dune-widget', handleOpen);
    return () => window.removeEventListener('open-dune-widget', handleOpen);
  }, []);

  // Fetch data on mount (for button score) and when widget opens
  useEffect(() => {
    if (!volumeData) {
      fetchVolumeData(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !volumeData) {
      fetchVolumeData(false);
    }
  }, [isOpen]);

  const handleTimezoneChange = (tz) => {
    setSelectedTimezone(tz);
    localStorage.setItem('dune-timezone', tz);
  };

  const handleDaysFilterChange = (days) => {
    setDaysFilter(days);
    localStorage.setItem('dune-days-filter', days.toString());
    fetchVolumeData(false, days);
    // Notify footer hook to refresh
    window.dispatchEvent(new CustomEvent('dune-filter-changed'));
  };

  const [executionAge, setExecutionAge] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const fetchVolumeData = async (forceRefresh = false, days = daysFilter, executeQuery = false) => {
    if (executeQuery) {
      setIsExecuting(true);
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.getDuneVolumeData(forceRefresh, days, executeQuery);
      if (res.data.success) {
        setVolumeData(res.data.data);
        setLastUpdate(new Date(res.data.lastFetch));
        setCacheInfo({
          cached: res.data.cached,
          expiresIn: res.data.cacheExpiresIn
        });
        // Check execution age if available
        if (res.data.executionAge !== undefined) {
          setExecutionAge(res.data.executionAge);
        }
      } else {
        setError(res.data.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch Dune data');
    } finally {
      setLoading(false);
      setIsExecuting(false);
    }
  };

  // Fetch fresh data by re-executing the Dune query
  const fetchFreshData = () => {
    fetchVolumeData(true, daysFilter, true);
  };

  // Get timezone offset
  const getTimezoneOffset = () => {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: selectedTimezone,
        hour: 'numeric',
        hour12: false
      });
      const localHour = parseInt(formatter.format(now));
      const utcHour = now.getUTCHours();
      let offset = localHour - utcHour;
      if (offset > 12) offset -= 24;
      if (offset < -12) offset += 24;
      return offset;
    } catch {
      return 0;
    }
  };

  const convertHour = (utcHour) => {
    const offset = getTimezoneOffset();
    let localHour = (utcHour + offset) % 24;
    if (localHour < 0) localHour += 24;
    return localHour;
  };

  const formatHour = (hour) => {
    const h = hour % 12 || 12;
    const ampm = hour < 12 ? 'a' : 'p';
    return `${h}${ampm}`;
  };

  const formatVolume = (vol) => {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  // Score color
  const getScoreColor = (score) => {
    if (score >= 70) return 'text-emerald-400';
    if (score >= 50) return 'text-amber-400';
    if (score >= 30) return 'text-orange-400';
    return 'text-red-400';
  };

  const getScoreBg = (score) => {
    if (score >= 70) return 'bg-emerald-500/10 border-emerald-500/30';
    if (score >= 50) return 'bg-amber-500/10 border-amber-500/30';
    if (score >= 30) return 'bg-orange-500/10 border-orange-500/30';
    return 'bg-red-500/10 border-red-500/30';
  };

  const getScoreLabel = (score) => {
    if (score >= 70) return 'Great';
    if (score >= 50) return 'Good';
    if (score >= 30) return 'Okay';
    return 'Wait';
  };

  // Prepare chart data based on view mode
  const currentUTCHour = volumeData?.currentHour ?? new Date().getUTCHours();
  const rawHourlyData = volumeData?.hourlyData || [];
  const rawTimelineData = volumeData?.timelineData || [];
  
  // chartData: what we actually render
  let chartData = [];
  let chartMode = 'hourly'; // 'hourly' = 24 bars, 'timeline' = all raw data points
  
  if (chartView === 'timeline' && rawTimelineData.length > 0) {
    // Timeline view: show all raw data points chronologically
    chartMode = 'timeline';
    chartData = rawTimelineData.map(d => ({
      date: d.date,
      hour: d.hour,
      volume: d.volume, // Use 'volume' for timeline, not 'avgVolume'
      timestamp: d.timestamp
    }));
  } else {
    // Hourly average view: 24 bars, ordered with current hour on RIGHT
    chartMode = 'hourly';
    for (let i = 1; i <= 24; i++) {
      const hour = (currentUTCHour + i) % 24;
      const hourData = rawHourlyData.find(h => h.hour === hour);
      if (hourData) {
        chartData.push({
          ...hourData,
          volume: hourData.avgVolume // Normalize to 'volume' key
        });
      }
    }
  }
  
  const volumeKey = 'volume';
  const maxVolume = chartData.length > 0 ? Math.max(...chartData.map(h => h[volumeKey] || 0)) : 0;
  const minVolume = chartData.length > 0 ? Math.min(...chartData.map(h => h[volumeKey] || 0)) : 0;
  const volumeRange = maxVolume - minVolume;

  // Chart height in pixels
  const CHART_HEIGHT = 120;
  
  // Get bar height in pixels (not percentage)
  const getBarHeight = (vol) => {
    if (volumeRange === 0 || !vol) return CHART_HEIGHT * 0.5;
    // Normalize to 10-100% of chart height
    const normalized = (vol - minVolume) / volumeRange;
    return Math.max(8, CHART_HEIGHT * (0.1 + normalized * 0.9));
  };
  
  // Format date for timeline tooltips
  const formatTimelineDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', { 
        timeZone: selectedTimezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const tzLabel = TIMEZONES.find(t => t.value === selectedTimezone)?.label?.split(' ')[0] || 'UTC';

  // Mini button for footer
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
        onClick={() => setIsOpen(false)}
      />
      
      {/* Widget Panel - Sleek Dark Theme - CENTERED */}
      <div className="relative bg-[#0d0d0f] border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto pointer-events-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/50">
          <div className="flex items-center gap-3">
            <ChartBarIcon className="w-5 h-5 text-gray-400" />
            <span className="font-semibold text-white">Launch Analytics</span>
            <span className="text-[10px] text-gray-600 bg-gray-800/50 px-2 py-0.5 rounded">
              via Dune
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* View Toggle: Avg vs Timeline */}
            <div className="flex bg-gray-800/50 rounded overflow-hidden">
              <button
                onClick={() => setChartView('avg')}
                className={`px-2 py-1 text-xs transition-colors ${
                  chartView === 'avg' 
                    ? 'bg-gray-700 text-white' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                title="Hourly averages (24 bars)"
              >
                Avg
              </button>
              <button
                onClick={() => setChartView('timeline')}
                className={`px-2 py-1 text-xs transition-colors ${
                  chartView === 'timeline' 
                    ? 'bg-gray-700 text-white' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                title={`All data points (${rawTimelineData.length} bars)`}
              >
                Timeline
              </button>
            </div>
            
            {/* Time Period */}
            <select
              value={daysFilter}
              onChange={(e) => handleDaysFilterChange(parseInt(e.target.value))}
              className="text-xs bg-transparent border border-gray-700 text-gray-400 rounded px-2 py-1 focus:outline-none focus:border-gray-600"
            >
              <option value={1}>24h</option>
              <option value={3}>3d</option>
              <option value={7}>7d</option>
              <option value={14}>14d</option>
            </select>
            
            {/* Timezone */}
            <select
              value={selectedTimezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              className="text-xs bg-transparent border border-gray-700 text-gray-400 rounded px-2 py-1 focus:outline-none focus:border-gray-600"
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            
            {/* Refresh (uses cached Dune data) */}
            <button
              onClick={() => fetchVolumeData(true)}
              disabled={loading || isExecuting}
              className="p-1.5 text-gray-500 hover:text-white rounded transition-colors disabled:opacity-50"
              title="Refresh cached data"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading && !isExecuting ? 'animate-spin' : ''}`} />
            </button>
            
            {/* Fetch Fresh Data (re-executes Dune query - uses credits) */}
            <button
              onClick={fetchFreshData}
              disabled={loading || isExecuting}
              className={`px-2 py-1 text-[10px] rounded transition-colors disabled:opacity-50 ${
                isExecuting 
                  ? 'bg-yellow-600 text-white animate-pulse' 
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
              title="Execute Dune query for fresh data (uses API credits)"
            >
              {isExecuting ? '⏳ Fetching...' : '🔄 Fresh'}
            </button>
            
            {/* Close */}
            <button 
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-gray-500 hover:text-white rounded transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          {loading && !volumeData && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-white rounded-full" />
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm mb-3">{error}</p>
              <button
                onClick={() => fetchVolumeData(true)}
                className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {volumeData && (
            <>
              {/* Score Row */}
              <div className="flex items-center gap-4 mb-6">
                {/* Main Score */}
                <div className={`flex-shrink-0 px-5 py-4 rounded-xl border ${getScoreBg(volumeData.launchScore)}`}>
                  <div className="text-xs text-gray-500 mb-1">Launch Score</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold ${getScoreColor(volumeData.launchScore)}`}>
                      {volumeData.launchScore}
                    </span>
                    <span className={`text-sm font-medium ${getScoreColor(volumeData.launchScore)}`}>
                      {getScoreLabel(volumeData.launchScore)}
                    </span>
                  </div>
                </div>

                {/* Current Hour */}
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-1">Current Hour ({tzLabel})</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-white">
                      {formatHour(convertHour(volumeData.currentHour))}
                    </span>
                    <span className="text-sm text-gray-500">
                      #{volumeData.currentRank}/24
                    </span>
                  </div>
                </div>

                {/* Best Hours */}
                <div>
                  <div className="text-xs text-gray-500 mb-1">Best Hours</div>
                  <div className="flex gap-1">
                    {volumeData.bestHours?.slice(0, 4).map(utcHour => (
                      <span 
                        key={utcHour} 
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          utcHour === volumeData.currentHour 
                            ? 'bg-emerald-500 text-white' 
                            : 'bg-gray-800 text-gray-300'
                        }`}
                      >
                        {formatHour(convertHour(utcHour))}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-[#111113] rounded-xl p-4 border border-gray-800/50">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs text-gray-500">
                    {chartMode === 'timeline' 
                      ? `Volume Timeline (${daysFilter}d) • ${tzLabel}` 
                      : `Hourly Volume (${daysFilter}d avg) • ${tzLabel}`
                    }
                  </span>
                  <span className="text-xs text-gray-600">
                    {chartData.length} {chartMode === 'timeline' ? 'data points' : 'hours'}
                  </span>
                </div>
                
                {/* Y-Axis Labels + Chart */}
                <div className="flex gap-2 overflow-hidden">
                  {/* Y-Axis */}
                  <div className="flex-shrink-0 flex flex-col justify-between text-right pr-1 w-12" style={{ height: `${CHART_HEIGHT}px` }}>
                    <span className="text-[10px] text-gray-500">{formatVolume(maxVolume)}</span>
                    <span className="text-[10px] text-gray-500">{formatVolume((maxVolume + minVolume) / 2)}</span>
                    <span className="text-[10px] text-gray-500">{formatVolume(minVolume)}</span>
                  </div>
                  
                  {/* Bars - constrained to fit container */}
                  <div 
                    className="flex-1 min-w-0 flex items-end gap-[1px] overflow-hidden" 
                    style={{ height: `${CHART_HEIGHT}px` }}
                  >
                    {chartData.map((dataPoint, idx) => {
                      const localHour = convertHour(dataPoint.hour);
                      const isCurrentHour = chartMode === 'hourly' && dataPoint.hour === volumeData.currentHour;
                      const isBestHour = chartMode === 'hourly' && volumeData.bestHours?.includes(dataPoint.hour);
                      const isWorstHour = chartMode === 'hourly' && volumeData.worstHours?.includes(dataPoint.hour);
                      const isLast = idx === chartData.length - 1;
                      
                      // Bar color
                      let barColor = 'bg-gray-600';
                      if (chartMode === 'timeline') {
                        // Timeline: gradient based on volume level
                        barColor = isLast ? 'bg-white' : 'bg-blue-500/70';
                      } else {
                        if (isCurrentHour) barColor = 'bg-white';
                        else if (isBestHour) barColor = 'bg-emerald-500';
                        else if (isWorstHour) barColor = 'bg-gray-700';
                      }
                      
                      const barHeight = getBarHeight(dataPoint.volume);
                      const barKey = chartMode === 'timeline' ? `${dataPoint.timestamp}-${idx}` : dataPoint.hour;
                      
                      // Calculate bar width based on number of data points
                      // Ensure bars fit within container
                      const barWidth = chartMode === 'timeline' && chartData.length > 50 
                        ? `${100 / chartData.length}%` 
                        : undefined;
                      
                      // Calculate predicted volume for current/last hour
                      // Uses the actual data point timestamp to calculate elapsed time
                      let predictedHeight = 0;
                      let showPrediction = false;
                      let predictedVolume = 0;
                      let minutesElapsed = 0;
                      
                      if (isLast && chartMode === 'timeline' && dataPoint.date) {
                        // Parse the data point's timestamp (this is UTC from Dune)
                        const dataPointTime = new Date(dataPoint.date);
                        const now = new Date();
                        
                        // Check if this data point is from the current hour
                        // The data point hour is when this bucket started
                        const dataHourStart = new Date(dataPointTime);
                        dataHourStart.setMinutes(0, 0, 0);
                        
                        const dataHourEnd = new Date(dataHourStart);
                        dataHourEnd.setHours(dataHourEnd.getHours() + 1);
                        
                        // Calculate how many minutes into this hour the data covers
                        // This is based on current time vs the hour start
                        const currentUTC = now.getTime();
                        const hourStartUTC = dataHourStart.getTime();
                        const hourEndUTC = dataHourEnd.getTime();
                        
                        // Only show prediction if we're still within this hour
                        if (currentUTC >= hourStartUTC && currentUTC < hourEndUTC) {
                          minutesElapsed = Math.floor((currentUTC - hourStartUTC) / 60000);
                          
                          // Only show prediction if we're past 5 minutes (to avoid crazy spikes)
                          if (minutesElapsed >= 5 && minutesElapsed < 60) {
                            const hourFraction = minutesElapsed / 60;
                            predictedVolume = dataPoint.volume / hourFraction;
                            
                            // Cap prediction to 2x max to avoid chart overflow
                            const cappedPredicted = Math.min(predictedVolume, maxVolume * 2);
                            predictedHeight = getBarHeight(cappedPredicted) - barHeight;
                            
                            if (predictedHeight > 2) {
                              showPrediction = true;
                            }
                          }
                        }
                      }
                      
                      return (
                        <div 
                          key={barKey}
                          className={`flex flex-col justify-end items-center group relative ${chartMode === 'timeline' && chartData.length > 50 ? '' : 'flex-1'}`}
                          style={{ 
                            height: `${CHART_HEIGHT}px`,
                            width: barWidth,
                            minWidth: chartMode === 'timeline' ? '1px' : undefined,
                            flexShrink: chartMode === 'timeline' ? 0 : undefined
                          }}
                        >
                          {/* Tooltip - only show on hover for timeline with many points */}
                          {(chartMode !== 'timeline' || chartData.length <= 100 || idx % 5 === 0 || isLast) && (
                            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 pointer-events-none">
                              <div className="bg-black border border-gray-700 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-xl">
                                {chartMode === 'timeline' ? (
                                  <>
                                    <div className="text-white font-medium">{formatTimelineDate(dataPoint.date)}</div>
                                    <div className="text-gray-400">{formatVolume(dataPoint.volume)}</div>
                                    {showPrediction && (
                                      <div className="text-yellow-400 border-t border-gray-700 pt-1 mt-1">
                                        <div className="text-[9px] text-gray-500">{minutesElapsed} min of 60</div>
                                        Est. full hour: {formatVolume(predictedVolume)}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <div className="text-white font-medium">{formatHour(localHour)} ({dataPoint.hour}:00 UTC)</div>
                                    <div className="text-gray-400">{formatVolume(dataPoint.volume)}</div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Prediction extension (dotted) - shown above the actual bar */}
                          {showPrediction && (
                            <div 
                              className="w-full border-l-2 border-r-2 border-t-2 border-dashed border-yellow-500/50 rounded-t"
                              style={{ 
                                height: `${predictedHeight}px`,
                                background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(234, 179, 8, 0.15) 2px, rgba(234, 179, 8, 0.15) 4px)'
                              }}
                            />
                          )}
                          
                          {/* Bar */}
                          <div 
                            className={`w-full rounded-t transition-all duration-200 ${barColor} ${
                              (isCurrentHour || isLast) ? 'shadow-[0_0_10px_rgba(255,255,255,0.3)]' : ''
                            }`}
                            style={{ height: `${barHeight}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* X-Axis */}
                <div className="flex mt-1 ml-14 overflow-hidden">
                  {chartMode === 'timeline' ? (
                    // Timeline: show date labels - simplified for large datasets
                    <div className="flex-1 flex justify-between">
                      <span className="text-[9px] text-gray-500">
                        {chartData.length > 0 ? formatTimelineDate(chartData[0].date).split(',')[0] : ''}
                      </span>
                      <span className="text-[9px] text-gray-500">
                        {chartData.length > 0 ? formatTimelineDate(chartData[Math.floor(chartData.length / 2)].date).split(',')[0] : ''}
                      </span>
                      <span className="text-[9px] text-white font-bold">Now</span>
                    </div>
                  ) : (
                    // Hourly avg: show hour labels
                    chartData.map((dataPoint, idx) => {
                      const localHour = convertHour(dataPoint.hour);
                      const isCurrentHour = dataPoint.hour === volumeData.currentHour;
                      // Show every 4th label + first + last
                      const showLabel = idx === 0 || idx === chartData.length - 1 || idx % 4 === 0;
                      
                      return (
                        <div key={dataPoint.hour} className="flex-1 text-center">
                          {showLabel && (
                            <span className={`text-[9px] ${isCurrentHour ? 'text-white font-bold' : 'text-gray-500'}`}>
                              {formatHour(localHour)}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Footer Info */}
              <div className="flex items-center justify-between mt-4 text-[10px] text-gray-600">
                <div className="flex items-center gap-3">
                  {chartMode === 'timeline' ? (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-white rounded-sm"></span> Latest
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-blue-500/70 rounded-sm"></span> History
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 border border-dashed border-yellow-500/70 rounded-sm"></span> Est.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-white rounded-sm"></span> Now
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-emerald-500/70 rounded-sm"></span> Best
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-gray-700 rounded-sm"></span> Normal
                      </span>
                    </>
                  )}
                </div>
                <div>
                  {cacheInfo?.cached ? `Cached • ` : ''}
                  {lastUpdate && lastUpdate.toLocaleTimeString()}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

