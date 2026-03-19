/**
 * Model Context v2 - Using Service Architecture
 * Refactored version using WorkerService, ModelLifecycleService, GenerationService, and StorageService
 * 
 * Performance Optimization: Uses useSyncExternalStore for efficient state subscriptions
 * to prevent global re-renders during model loading progress ticks.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode, useSyncExternalStore } from 'react';
import { config } from '../config';
import { detectDeviceResources, getRecommendedSettings } from '../utils/resourceDetector';
import { assertStorageAvailability } from '../utils/storageQuota';
import type {
  ModelState,
  WebGPUCapabilities,
  DeviceResources,
  GenerationSettings,
  BookSettings,
  OutlineItem,
  Book,
  ImageResult,
  ImageGenerationOptions,
  TextGenerationOptions,
  ModelStatusType,
  WorkerEventType,
  WorkerEventPayloads,
} from '../types';
import { modelLogger } from '../utils/logger';
import { useProgressThrottle } from '../hooks/useProgressThrottle';
import {
  WorkerService,
  getWorkerService,
  ModelLifecycleService,
  GenerationService,
  StorageService,
  ModelStates,
} from '../core';
import GenerationWorker from '../workers/GenerationWorker?worker';

// Re-export context types for backward compatibility
export const ModelStatus = {
  IDLE: 'Idle',
  LOADING: 'Loading',
  READY: 'Ready',
  ERROR: 'Error',
  UNLOADED: 'Unloaded',
} as const;

export const ModelType = {
  TEXT: 'text',
  IMAGE: 'image',
} as const;

// Context types (same as original for compatibility)
export const ModelActionsContext = createContext<null | {
  generateText: (prompt: string, options?: TextGenerationOptions) => Promise<string | null>;
  generateQuip: (content: string) => Promise<string | null>;
  generateOutline: (subject: string, settings: BookSettings, numPages: number) => Promise<string>;
  initTextModel: (modelType?: 'fast' | 'quality') => Promise<boolean>;
  unloadTextModel: () => Promise<void>;
  generateImage: (prompt: string, options?: ImageGenerationOptions) => Promise<ImageResult | null>;
  initImageModel: () => Promise<boolean>;
  unloadImageModel: () => Promise<void>;
  startBookGeneration: (settings: BookSettings, outline: OutlineItem[], numPages: number) => Promise<void>;
  cancelBookGeneration: () => Promise<void>;
  subscribeToWorkerEvents: (callback: (data: { type: string; payload?: Record<string, unknown> }) => void) => () => void;
  unloadAllModels: () => Promise<void>;
  retryInit: (modelType: 'text' | 'image') => Promise<boolean>;
  getModelStatus: () => Promise<Record<string, string> | null>;
  toggleSpeedMode: (enabled: boolean) => void;
  getGenerationSettings: () => GenerationSettings;
  fetchCacheStats: () => Promise<{ count: number; sizeBytes: number; sizeFormatted: string }>;
  clearImageCache: () => Promise<void>;
  saveBookToDB: (book: Book) => Promise<string | null>;
  getSavedBook: (bookId: string) => Promise<Book | null>;
  getSavedBooks: () => Promise<Book[]>;
  deleteSavedBook: (bookId: string) => Promise<boolean>;
}>(null);

export const ModelStateContext = createContext<null | {
  textModel: ModelState;
  qualityTextModel: ModelState;
  imageModel: ModelState;
  activeTextModel: 'fast' | 'quality';
  speedMode: boolean;
  deviceResources: DeviceResources | null;
  webgpuCapabilities: WebGPUCapabilities | null;
  isWebGPUSupported: boolean;
  storageStatus: {
    available: boolean;
    quota: number;
    usage: number;
    usageFormatted: string;
    quotaFormatted: string;
    percentUsed: number;
  } | null;
}>(null);

interface ModelProviderProps {
  children: ReactNode;
  workerUrl?: string; // Allow custom worker URL for testing
}

/**
 * ModelProvider v2 - Uses service architecture internally
 */
export const ModelProvider: React.FC<ModelProviderProps> = ({
  children,
  workerUrl,
}) => {
  // Service instances - initialized immediately to avoid null checks in hooks
  const workerServiceRef = useRef<WorkerService>(getWorkerService());
  const modelLifecycleRef = useRef<ModelLifecycleService>(new ModelLifecycleService({ workerService: getWorkerService() }));
  const generationRef = useRef<GenerationService>(new GenerationService({ workerService: getWorkerService() }));
  const storageRef = useRef<StorageService>(new StorageService());

  // State from services
  const [modelStates, setModelStates] = useState<ModelStates>({
    textModel: { status: 'Idle', loading: false, progress: 0, error: null, device: null, modelName: null },
    qualityTextModel: { status: 'Idle', loading: false, progress: 0, error: null, device: null, modelName: null },
    imageModel: { status: 'Idle', loading: false, progress: 0, error: null, device: null, modelName: null },
    activeTextModel: 'fast',
  });

  // Other state
  const [speedMode, setSpeedMode] = useState(false);
  const [deviceResources, setDeviceResources] = useState<DeviceResources | null>(null);
  const [webgpuCapabilities, setWebgpuCapabilities] = useState<WebGPUCapabilities | null>(null);
  const [storageStatus, setStorageStatus] = useState<{
    available: boolean;
    quota: number;
    usage: number;
    usageFormatted: string;
    quotaFormatted: string;
    percentUsed: number;
  } | null>(null);

  // Progress throttling
  const onProgressUpdate = useCallback((modelType: string, progress: number, status?: ModelStatusType) => {
    modelLifecycleRef.current?.handleModelProgress(modelType, progress, status);
  }, []);

  const { handleProgress } = useProgressThrottle(onProgressUpdate);

  // Initialize services on mount
  useEffect(() => {
    // Initialize worker service
    const workerService = workerServiceRef.current;
    if (workerUrl) {
      workerService.initialize(workerUrl);
    } else {
      const worker = new GenerationWorker();
      workerService.initializeWithWorker(worker);
    }

    // Subscribe to model state changes
    const unsubscribeStates = modelLifecycleRef.current?.subscribeState(setModelStates);

    // Subscribe to worker events
    const unsubscribeStart = workerService.subscribe('PAGE_START', (payload) => {
      // Forward to any external subscribers (for useBookGeneration compatibility)
      workerEventSubscribersRef.current.forEach(cb => {
        try {
          cb({ type: 'PAGE_START', payload: payload as unknown as Record<string, unknown> });
        } catch (err) {
          modelLogger.error('Event subscriber error', { error: err as Error });
        }
      });
    });

    const unsubscribeComplete = workerService.subscribe('PAGE_COMPLETE', (payload) => {
      workerEventSubscribersRef.current.forEach(cb => {
        try {
          cb({ type: 'PAGE_COMPLETE', payload: payload as unknown as Record<string, unknown> });
        } catch (err) {
          modelLogger.error('Event subscriber error', { error: err as Error });
        }
      });
    });

    const unsubscribeError = workerService.subscribe('PAGE_ERROR', (payload) => {
      workerEventSubscribersRef.current.forEach(cb => {
        try {
          cb({ type: 'PAGE_ERROR', payload: payload as unknown as Record<string, unknown> });
        } catch (err) {
          modelLogger.error('Event subscriber error', { error: err as Error });
        }
      });
    });

    const unsubscribeQueue = workerService.subscribe('QUEUE_COMPLETE', () => {
      workerEventSubscribersRef.current.forEach(cb => {
        try {
          cb({ type: 'QUEUE_COMPLETE', payload: {} });
        } catch (err) {
          modelLogger.error('Event subscriber error', { error: err as Error });
        }
      });
    });

    const unsubscribeCancelled = workerService.subscribe('GENERATION_CANCELLED', () => {
      workerEventSubscribersRef.current.forEach(cb => {
        try {
          cb({ type: 'GENERATION_CANCELLED', payload: {} });
        } catch (err) {
          modelLogger.error('Event subscriber error', { error: err as Error });
        }
      });
    });

    // Detect device capabilities
    const detectCapabilities = async () => {
      try {
        const { detectCapabilities: detectCaps } = await import('web-txt2img');
        const caps = await detectCaps();
        setWebgpuCapabilities(caps);
      } catch (err) {
        modelLogger.warn('Failed to detect WebGPU capabilities', { error: err as Error });
        setWebgpuCapabilities({ webgpu: false, shaderF16: false });
      }
    };

    const detectResources = async () => {
      try {
        const { detectDeviceResources } = await import('../utils/resourceDetector');
        const resources = await detectDeviceResources();
        setDeviceResources(resources);
        setSpeedMode(resources.isLowMemory);
      } catch (err) {
        modelLogger.warn('Failed to detect device resources', { error: err as Error });
        setDeviceResources({
          deviceMemory: null,
          hardwareConcurrency: null,
          hasWebGPU: false,
          hasShaderF16: false,
          isLowMemory: true,
          limitations: ['Resource detection failed'],
        });
        setSpeedMode(true);
      }
    };

    const checkStorage = async () => {
      try {
        const { getStorageStatus } = await import('../utils/storageQuota');
        const status = await getStorageStatus();
        setStorageStatus({
          available: status.status !== 'critical',
          quota: status.quota.quota,
          usage: status.quota.usage,
          usageFormatted: status.quota.usageFormatted,
          quotaFormatted: status.quota.quotaFormatted,
          percentUsed: status.quota.percentUsed,
        });
      } catch (err) {
        modelLogger.warn('Failed to check storage', { error: err as Error });
      }
    };

    detectCapabilities();
    detectResources();
    checkStorage();

    // Cleanup on unmount
    return () => {
      unsubscribeStates();
      unsubscribeStart();
      unsubscribeComplete();
      unsubscribeError();
      unsubscribeQueue();
      unsubscribeCancelled();

      generationRef.current?.cleanup();
      workerServiceRef.current?.cleanup();
    };
  }, [workerUrl]);

  // Worker event subscribers (for useBookGeneration compatibility)
  const workerEventSubscribersRef = useRef<Set<(data: { type: string; payload?: Record<string, unknown> }) => void>>(new Set());

  // Action implementations using services
  const initTextModel = useCallback(async (modelType: 'fast' | 'quality' = 'fast'): Promise<boolean> => {
    // Check storage first
    try {
      const requirement = modelType === 'quality' ? 'quality' : 'fast';
      await assertStorageAvailability(requirement);
    } catch (err) {
      modelLogger.error('Storage check failed', { error: err as Error });
      return false;
    }

    const result = await modelLifecycleRef.current?.initTextModel(modelType);
    return result?.success || false;
  }, []);

  const initImageModel = useCallback(async (): Promise<boolean> => {
    try {
      await assertStorageAvailability('image');
    } catch (err) {
      modelLogger.error('Storage check failed', { error: err as Error });
      return false;
    }

    const result = await modelLifecycleRef.current?.initImageModel();
    return result?.success || false;
  }, []);

  const generateText = useCallback(async (prompt: string, options: TextGenerationOptions = {}): Promise<string | null> => {
    return generationRef.current?.generateText(prompt, options) || null;
  }, []);

  const generateQuip = useCallback(async (content: string): Promise<string | null> => {
    return generationRef.current?.generateQuip(content) || null;
  }, []);

  const generateImage = useCallback(async (prompt: string, options: ImageGenerationOptions = {}): Promise<ImageResult | null> => {
    return generationRef.current?.generateImage(prompt, options) || null;
  }, []);

  const generateOutline = useCallback(async (subject: string, settings: BookSettings, numPages: number): Promise<string> => {
    return generationRef.current?.generateOutline(subject, settings, numPages) || '';
  }, []);

  const startBookGeneration = useCallback(async (settings: BookSettings, outline: OutlineItem[], numPages: number): Promise<void> => {
    await generationRef.current?.startBookGeneration(settings, outline, numPages);
  }, []);

  const cancelBookGeneration = useCallback(async (): Promise<void> => {
    await generationRef.current?.cancelBookGeneration();
  }, []);

  const unloadTextModel = useCallback(async (): Promise<void> => {
    await modelLifecycleRef.current?.unloadTextModel();
  }, []);

  const unloadImageModel = useCallback(async (): Promise<void> => {
    await modelLifecycleRef.current?.unloadImageModel();
  }, []);

  const unloadAllModels = useCallback(async (): Promise<void> => {
    await modelLifecycleRef.current?.unloadAllModels();
  }, []);

  const getModelStatus = useCallback(async (): Promise<Record<string, string> | null> => {
    return modelLifecycleRef.current?.getModelStatus() || null;
  }, []);

  const subscribeToWorkerEvents = useCallback((callback: (data: { type: string; payload?: Record<string, unknown> }) => void) => {
    workerEventSubscribersRef.current.add(callback);
    return () => {
      workerEventSubscribersRef.current.delete(callback);
    };
  }, []);

  const retryInit = useCallback(async (modelType: 'text' | 'image'): Promise<boolean> => {
    if (modelType === 'text') {
      return await initTextModel();
    } else if (modelType === 'image') {
      return await initImageModel();
    }
    return false;
  }, [initTextModel, initImageModel]);

  const toggleSpeedMode = useCallback((enabled: boolean) => {
    setSpeedMode(enabled);
  }, []);

  const getGenerationSettings = useCallback((): GenerationSettings => {
    if (!deviceResources) {
      return {
        mode: 'quality',
        imageSteps: 4,
        imageResolution: { width: 512, height: 512 },
        skipImageGeneration: false,
        description: 'Detecting resources...',
      };
    }

    const recommended = getRecommendedSettings(deviceResources);

    if (speedMode && !deviceResources.isLowMemory) {
      return {
        mode: 'speed',
        imageSteps: 2,
        imageResolution: { width: 384, height: 384 },
        skipImageGeneration: false,
        description: 'Speed mode enabled',
      };
    }

    return recommended;
  }, [deviceResources, speedMode]);

  const fetchCacheStats = useCallback(async () => {
    return storageRef.current?.getCacheStatistics() || { count: 0, sizeBytes: 0, sizeFormatted: '0 B' };
  }, []);

  const clearImageCache = useCallback(async () => {
    await storageRef.current?.clearImageCache();
  }, []);

  const saveBookToDB = useCallback(async (book: Book): Promise<string | null> => {
    return storageRef.current?.saveBook(book) || null;
  }, []);

  const getSavedBook = useCallback(async (bookId: string): Promise<Book | null> => {
    return storageRef.current?.getBook(bookId) || null;
  }, []);

  const getSavedBooks = useCallback(async (): Promise<Book[]> => {
    return storageRef.current?.getAllSavedBooks() || [];
  }, []);

  const deleteSavedBook = useCallback(async (bookId: string): Promise<boolean> => {
    return storageRef.current?.deleteSavedBook(bookId) || false;
  }, []);

  // Context values
  // Note: modelStates is NOT included in stateContextValue to prevent global re-renders
  // Components should use useModelStore(selector) for efficient subscriptions
  const actionsContextValue = useMemo(() => ({
    generateText,
    generateQuip,
    generateOutline,
    initTextModel,
    unloadTextModel,
    generateImage,
    initImageModel,
    unloadImageModel,
    startBookGeneration,
    cancelBookGeneration,
    subscribeToWorkerEvents,
    unloadAllModels,
    retryInit,
    getModelStatus,
    toggleSpeedMode,
    getGenerationSettings,
    fetchCacheStats,
    clearImageCache,
    saveBookToDB,
    getSavedBook,
    getSavedBooks,
    deleteSavedBook,
  }), [
    generateText, generateQuip, generateOutline, initTextModel, unloadTextModel,
    generateImage, initImageModel, unloadImageModel, startBookGeneration,
    cancelBookGeneration, subscribeToWorkerEvents, unloadAllModels, retryInit,
    getModelStatus, toggleSpeedMode, getGenerationSettings, fetchCacheStats,
    clearImageCache, saveBookToDB, getSavedBook, getSavedBooks, deleteSavedBook,
  ]);

  // State context only includes non-subscription values (device info, capabilities, etc.)
  const stateContextValue = useMemo(() => ({
    // Expose individual model states for backward compatibility
    // These will be updated via useModelStore in migrated components
    textModel: modelStates.textModel,
    qualityTextModel: modelStates.qualityTextModel,
    imageModel: modelStates.imageModel,
    activeTextModel: modelStates.activeTextModel,
    speedMode,
    deviceResources,
    webgpuCapabilities,
    isWebGPUSupported: !!(webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16),
    storageStatus,
  }), [modelStates, speedMode, deviceResources, webgpuCapabilities, storageStatus]);

  return (
    <ModelServiceInstanceContext.Provider value={modelLifecycleRef}>
      <ModelActionsContext.Provider value={actionsContextValue}>
        <ModelStateContext.Provider value={stateContextValue}>
          {children}
        </ModelStateContext.Provider>
      </ModelActionsContext.Provider>
    </ModelServiceInstanceContext.Provider>
  );
};

// Extended state interface that includes all context values
export interface ModelContextState extends ModelStates {
  speedMode: boolean;
  deviceResources: DeviceResources | null;
  webgpuCapabilities: WebGPUCapabilities | null;
  isWebGPUSupported: boolean;
  storageStatus: {
    available: boolean;
    quota: number;
    usage: number;
    usageFormatted: string;
    quotaFormatted: string;
    percentUsed: number;
  } | null;
}

/**
 * useModelStore - Custom hook using useSyncExternalStore for efficient subscriptions
 *
 * This allows components to subscribe to specific slices of model state,
 * preventing global re-renders when progress ticks occur.
 *
 * @param selector - Function to select specific state from ModelContextState
 * @returns Selected state slice
 */
export function useModelStore<T>(selector: (states: ModelContextState) => T): T {
  // Get the service instance from a ref maintained by ModelProvider
  const serviceRef = useContext(ModelServiceInstanceContext);
  const stateContext = useContext(ModelStateContext);

  if (!serviceRef || !serviceRef.current || !stateContext) {
    throw new Error('useModelStore must be used within a ModelProvider');
  }

  const service = serviceRef.current;

  // useSyncExternalStore subscribes to ModelLifecycleService state changes
  // and only re-renders when the selected value changes (shallow comparison)
  const modelStates = useSyncExternalStore(
    // Subscribe function - returns unsubscribe function
    (callback) => service.subscribeState(callback),
    // Get current value (for current render) - must return stable reference
    () => service.getSnapshot(),
    // Get server value (same as client for this use case)
    () => service.getSnapshot()
  );

  // Combine model states with other context values
  const fullState: ModelContextState = useMemo(() => ({
    ...modelStates,
    speedMode: stateContext.speedMode,
    deviceResources: stateContext.deviceResources,
    webgpuCapabilities: stateContext.webgpuCapabilities,
    isWebGPUSupported: stateContext.isWebGPUSupported,
    storageStatus: stateContext.storageStatus,
  }), [modelStates, stateContext]);

  return selector(fullState);
}

/**
 * useModelState - Backward compatibility hook
 * Returns all model states for components that haven't been migrated
 * @deprecated Use useModelStore with a selector for better performance
 */
export const useModelState = () => {
  // For backward compatibility, return the full state via useModelStore
  return useModelStore((states) => states);
};

/**
 * useModelActions - Get model action functions
 */
export const useModelActions = () => {
  const context = useContext(ModelActionsContext);
  if (!context) {
    throw new Error('useModelActions must be used within a ModelProvider');
  }
  return context;
};

/**
 * useModel - Combined hook for actions and state
 * @deprecated For state, use useModelStore with a selector for better performance
 */
export const useModel = () => {
  const actions = useContext(ModelActionsContext);
  const state = useModelState();
  if (!actions) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return { ...actions, ...state };
};

// Internal context to expose the ModelLifecycleService instance
const ModelServiceInstanceContext = createContext<React.MutableRefObject<ModelLifecycleService | null> | null>(null);

export default ModelActionsContext;
