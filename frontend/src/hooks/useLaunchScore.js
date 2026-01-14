import { useState, useEffect } from 'react';
import apiService from '../services/api';

// Hook to get the current launch score for the footer button
export function useLaunchScore() {
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recommendation, setRecommendation] = useState(null);

  useEffect(() => {
    const fetchScore = async () => {
      try {
        // Use the same days filter as the widget (from localStorage), default to 7
        const daysFilter = parseInt(localStorage.getItem('dune-days-filter')) || 7;
        const res = await apiService.getDuneVolumeData(false, daysFilter);
        if (res.data.success && res.data.data) {
          setScore(res.data.data.launchScore);
          setRecommendation(res.data.data.recommendation);
        }
      } catch (e) {
        console.error('Failed to fetch launch score:', e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchScore();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchScore, 5 * 60 * 1000);
    
    // Also listen for filter changes (when user changes filter in widget)
    const handleFilterChange = () => fetchScore();
    window.addEventListener('dune-filter-changed', handleFilterChange);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('dune-filter-changed', handleFilterChange);
    };
  }, []);

  return { score, loading, recommendation };
}

export default useLaunchScore;
