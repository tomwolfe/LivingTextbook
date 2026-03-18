import { useRef, useEffect, useCallback } from 'react';
import type { ModelStatusType } from '../types';

const PROGRESS_THROTTLE_MS = 150;

interface ProgressUpdate {
  progress: number;
  status?: ModelStatusType;
}

interface ThrottleState {
  lastUpdate: number;
  pending: ProgressUpdate | null;
}

/**
 * Custom hook to throttle progress updates from AI models
 * Prevents UI render thrashing during high-frequency worker events
 * 
 * @param onUpdate Callback function to apply the throttled update
 * @returns Object with handleProgress function
 */
export function useProgressThrottle(
  onUpdate: (modelType: string, progress: number, status?: ModelStatusType) => void
) {
  const throttleRef = useRef<Record<string, ThrottleState>>({
    text: { lastUpdate: 0, pending: null },
    image: { lastUpdate: 0, pending: null },
  });

  const handleProgress = useCallback((modelType: string, progress: number, status?: ModelStatusType) => {
    const type = (modelType === 'fast' || modelType === 'quality') ? 'text' : 'image';
    const state = throttleRef.current[type];
    const now = Date.now();

    // Always bypass throttle for 100% or "Ready" status
    const shouldBypassThrottle = progress >= 100 || status === 'Ready';

    if (shouldBypassThrottle || (now - state.lastUpdate) >= PROGRESS_THROTTLE_MS) {
      // Update immediately
      state.lastUpdate = now;
      state.pending = null;
      onUpdate(modelType, progress, status);
    } else {
      // Store pending update
      state.pending = { progress, status };
    }
  }, [onUpdate]);

  // Periodic flush of pending updates
  useEffect(() => {
    const flushInterval = setInterval(() => {
      const now = Date.now();
      
      Object.keys(throttleRef.current).forEach(type => {
        const state = throttleRef.current[type];
        if (state.pending) {
          const { progress, status } = state.pending;
          state.lastUpdate = now;
          state.pending = null;
          // For the flush, we use the specific type ('text' or 'image') 
          // but ModelContext handles the sub-types ('fast'/'quality')
          onUpdate(type, progress, status);
        }
      });
    }, PROGRESS_THROTTLE_MS);

    return () => clearInterval(flushInterval);
  }, [onUpdate]);

  return { handleProgress };
}

export default useProgressThrottle;
