/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { config } from '../config';
import { detectDeviceResources, getRecommendedSettings } from '../utils/resourceDetector.ts';
import { saveBook, getBook, getAllBooks, deleteBook, getCacheStats, clearImageCache, getCachedImage } from '../utils/imageCache.ts';
import { MainThreadRPC } from '../utils/workerRPC.ts';
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
  ModelStatusType
} from '../types';

/**
 * Model Status Enum
 */
export const ModelStatus = {
  IDLE: 'Idle',
  LOADING: 'Loading',
  READY: 'Ready',
  ERROR: 'Error',
  UNLOADED: 'Unloaded',
} as const;

/**
 * Model Type Enum
 */
export const ModelType = {
  TEXT: 'text',
  IMAGE: 'image',
} as const;

/**
 * Initial state for a model
 */
const createInitialModelState = (): ModelState => ({
  status: ModelStatus.IDLE,
  loading: false,
  progress: 0,
  error: null,
  device: null,
  modelName: null,
});

/**
 * Model Actions Context - provides stable async functions
 * This context rarely changes, so consumers won't re-render on progress ticks
 */
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

/**
 * Model State Context - provides frequently updating state
 * Only components that need to display progress should consume this
 */
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

/**
 * Provider component that manages AI model lifecycle via worker
 */
export const ModelProvider = ({ children }: { children: ReactNode }) => {
  // Text generation model state (fast model - SmolLM2)
  const [textModelState, setTextModelState] = useState<ModelState>(createInitialModelState());

  // Quality text generation model state (Qwen2.5)
  const [qualityTextModelState, setQualityTextModelState] = useState<ModelState>(createInitialModelState());

  // Track which model is currently active
  const [activeTextModel, setActiveTextModel] = useState<'fast' | 'quality'>('fast');

  // Image generation model state
  const [imageModelState, setImageModelState] = useState<ModelState>(createInitialModelState());

  // WebGPU capability state
  const [webgpuCapabilities, setWebgpuCapabilities] = useState<WebGPUCapabilities | null>(null);

  // Device resource state for Speed Mode
  const [deviceResources, setDeviceResources] = useState<DeviceResources | null>(null);
  const [speedMode, setSpeedMode] = useState(false);

  // Storage quota state
  const [storageStatus, setStorageStatus] = useState<{
    available: boolean;
    quota: number;
    usage: number;
    usageFormatted: string;
    quotaFormatted: string;
    percentUsed: number;
  } | null>(null);

  // Worker and RPC
  const workerRef = useRef<Worker | null>(null);
  const rpcRef = useRef<MainThreadRPC | null>(null);
  // Track blob URLs to prevent memory leaks
  const blobUrlsRef = useRef<Set<string>>(new Set());

  /**
   * Detect WebGPU capabilities and device resources on mount
   */
  useEffect(() => {
    const detectCaps = async () => {
      try {
        const { detectCapabilities } = await import('web-txt2img');
        const caps = await detectCapabilities();
        setWebgpuCapabilities(caps);
      } catch (err) {
        console.warn('Failed to detect WebGPU capabilities:', err);
        setWebgpuCapabilities({ webgpu: false, shaderF16: false });
      }
    };

    const detectResources = async () => {
      try {
        const resources = await detectDeviceResources();
        setDeviceResources(resources);
        setSpeedMode(resources.isLowMemory);
      } catch (err) {
        console.warn('Failed to detect device resources:', err);
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

    detectCaps();
    detectResources();
  }, []);

  /**
   * Check storage quota on mount
   */
  useEffect(() => {
    const checkStorage = async () => {
      try {
        const { getStorageStatus } = await import('../utils/storageQuota');
        const status = await getStorageStatus();
        // Map the storage status to our local state type
        setStorageStatus({
          available: status.status !== 'critical',
          quota: status.quota.quota,
          usage: status.quota.usage,
          usageFormatted: status.quota.usageFormatted,
          quotaFormatted: status.quota.quotaFormatted,
          percentUsed: status.quota.percentUsed,
        });
      } catch (err) {
        console.warn('Failed to check storage:', err);
      }
    };

    checkStorage();
  }, []);

  /**
   * Initialize worker and RPC
   */
  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL('../workers/GenerationWorker.js', import.meta.url),
      { type: 'module' }
    );

    // Initialize RPC
    rpcRef.current = new MainThreadRPC(workerRef.current);

    // Set up handler for worker-initiated events
    rpcRef.current.setWorkerMessageHandler((data) => {
      const { type, payload } = data as { type: string; payload?: Record<string, unknown> };

      switch (type) {
        case 'MODEL_PROGRESS': {
          const { modelType, progress, status } = payload || {};
          if (modelType === 'fast' || modelType === 'quality') {
            setQualityTextModelState(prev => ({
              ...prev,
              progress: progress as number || 0,
              status: (status as ModelStatusType) || prev.status,
              loading: (progress as number || 0) < 100,
            }));
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              progress: progress as number || 0,
              status: (status as ModelStatusType) || prev.status,
              loading: (progress as number || 0) < 100,
            }));
          }
          break;
        }

        case 'MODEL_LOADED': {
          const { modelType, device, modelName } = payload || {};
          if (modelType === 'fast' || modelType === 'quality') {
            setQualityTextModelState(prev => ({
              ...prev,
              status: ModelStatus.READY,
              loading: false,
              progress: 100,
              device: device as string || 'WebGPU',
              modelName: modelName as string || prev.modelName,
            }));
            setActiveTextModel(modelType as 'fast' | 'quality');
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              status: ModelStatus.READY,
              loading: false,
              progress: 100,
              device: device as string || 'WebGPU',
            }));
          }
          break;
        }

        case 'MODEL_ERROR': {
          const { modelType, error } = payload || {};
          if (modelType === 'fast' || modelType === 'quality') {
            setQualityTextModelState(prev => ({
              ...prev,
              status: ModelStatus.ERROR,
              loading: false,
              error: error as string || 'Model load failed',
            }));
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              status: ModelStatus.ERROR,
              loading: false,
              error: error as string || 'Model load failed',
            }));
          }
          break;
        }

        case 'MODEL_UNLOADED': {
          const { modelType } = payload || {};
          if (modelType === 'fast' || modelType === 'quality') {
            setQualityTextModelState(createInitialModelState());
          } else if (modelType === 'image') {
            setImageModelState(createInitialModelState());
          }
          break;
        }

        case 'GENERATION_PROGRESS': {
          // Silently handle generation progress - UI updates via model state
          break;
        }

        case 'PAGE_START':
        case 'PAGE_COMPLETE':
        case 'PAGE_ERROR':
        case 'QUEUE_COMPLETE':
        case 'GENERATION_CANCELLED': {
          // Forward these events via custom event for App to listen to
          window.dispatchEvent(new CustomEvent('worker-generation-event', { detail: data }));
          break;
        }

        default:
          break;
      }
    });

    // Cleanup on unmount
    return () => {
      // Revoke all blob URLs to prevent memory leaks
      blobUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {
          console.warn('Failed to revoke blob URL:', err);
        }
      });
      blobUrlsRef.current.clear();

      if (rpcRef.current) {
        rpcRef.current.cleanup();
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  /**
   * Initialize text model via worker
   */
  const initTextModel = useCallback(async (modelType: 'fast' | 'quality' = 'fast'): Promise<boolean> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    const isQuality = modelType === 'quality';

    // Check storage quota before downloading
    try {
      const requirement = modelType === 'quality' ? 'quality' : 'fast';
      await assertStorageAvailability(requirement);
    } catch (err) {
      console.error('Storage check failed:', err);
      const setState = isQuality ? setQualityTextModelState : setTextModelState;
      setState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: `Insufficient storage: ${(err as Error).message}`,
      }));
      return false;
    }

    const setState = isQuality ? setQualityTextModelState : setTextModelState;
    setState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const result = await rpcRef.current.send('INIT_MODELS', {
        modelTypes: [modelType],
      });

      return (result as Record<string, { success?: boolean }>)?.[modelType]?.success || false;
    } catch (err) {
      console.error('Failed to initialize text model:', err);
      const setState = isQuality ? setQualityTextModelState : setTextModelState;
      setState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: (err as Error).message || 'Failed to load text model',
      }));
      return false;
    }
  }, []);

  /**
   * Initialize image model via worker
   */
  const initImageModel = useCallback(async (): Promise<boolean> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    // Check storage quota before downloading
    try {
      await assertStorageAvailability('image');
    } catch (err) {
      console.error('Storage check failed:', err);
      setImageModelState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: `Insufficient storage: ${(err as Error).message}`,
      }));
      return false;
    }

    setImageModelState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const result = await rpcRef.current.send('INIT_MODELS', {
        modelTypes: ['image'],
      });
      return (result as Record<string, { success?: boolean }>)?.image?.success || false;
    } catch (err) {
      console.error('Failed to initialize image model:', err);
      setImageModelState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: (err as Error).message || 'Failed to load image model',
      }));
      return false;
    }
  }, []);

  /**
   * Generate text from a prompt via worker
   */
  const generateText = useCallback(async (prompt: string, options: TextGenerationOptions = {}): Promise<string | null> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    const { complexity, skipStatus, ...generationOptions } = options;
    const isQuality = complexity !== undefined && complexity >= config.textGen.complexityThreshold;

    if (!skipStatus) {
      const setState = isQuality ? setQualityTextModelState : setTextModelState;
      setState(prev => ({ ...prev, loading: true, status: 'Generating Content...' as ModelStatusType }));
    }

    try {
      const result = await rpcRef.current.send('GENERATE_TEXT', {
        prompt,
        options: {
          complexity,
          ...generationOptions,
        },
      });

      if (!skipStatus) {
        const setState = isQuality ? setQualityTextModelState : setTextModelState;
        setState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
      }

      return result as string;
    } catch (err) {
      console.error('Text generation error:', err);
      if (!skipStatus) {
        const setState = isQuality ? setQualityTextModelState : setTextModelState;
        setState(prev => ({
          ...prev,
          loading: false,
          status: ModelStatus.ERROR,
          error: (err as Error).message || 'Generation failed',
        }));
      }
      return null;
    }
  }, []);

  /**
   * Generate a witty quip via worker
   */
  const generateQuip = useCallback(async (content: string): Promise<string | null> => {
    try {
      const quip = await generateText(content, {
        systemPrompt: 'You are Logic the Lemur, a sassy, playful character who breaks the fourth wall.',
        maxTokens: 50,
        temperature: 0.9,
        skipStatus: true,
      });
      return quip;
    } catch (err) {
      console.warn('Failed to generate quip:', err);
      return null;
    }
  }, [generateText]);

  /**
   * Generate image from a prompt via worker
   */
  const generateImageFromPrompt = useCallback(async (prompt: string, options: ImageGenerationOptions = {}): Promise<ImageResult | null> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    const { skipCache = false, useCache = true, negativePrompt } = options;

    // Check cache first (unless disabled)
    const cachePrompt = negativePrompt ? `${prompt}|${negativePrompt}` : prompt;
    if (useCache && !skipCache) {
      try {
        const cachedBlob = await getCachedImage(cachePrompt);
        if (cachedBlob) {
          console.log('[ImageCache] Hit for prompt:', prompt.substring(0, 50));
          const imageUrl = URL.createObjectURL(cachedBlob);
          blobUrlsRef.current.add(imageUrl);
          return { imageUrl, blob: cachedBlob, cached: true };
        }
      } catch (err) {
        console.warn('[ImageCache] Failed to get cached image:', err);
      }
    }

    setImageModelState(prev => ({ ...prev, loading: true, status: 'Generating Image...' as ModelStatusType }));

    try {
      const result = await rpcRef.current.send('GENERATE_IMAGE', {
        prompt,
        options: { negativePrompt, useCache: false }, // Cache already checked above
      });

      // Worker returns ArrayBuffer via zero-copy transfer - reconstruct blob on main thread
      const resultTyped = result as { buffer?: ArrayBuffer; type?: string; cached?: boolean } | null;
      if (resultTyped?.buffer) {
        const blob = new Blob([resultTyped.buffer], { type: resultTyped.type || 'image/png' });
        const imageUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.add(imageUrl);

        setImageModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
        return { imageUrl, blob, cached: resultTyped.cached || false };
      } else {
        throw new Error('Image generation failed');
      }
    } catch (err) {
      console.error('Image generation error:', err);
      setImageModelState(prev => ({
        ...prev,
        loading: false,
        status: ModelStatus.ERROR,
        error: (err as Error).message || 'Image generation failed',
      }));
      return null;
    }
  }, []);

  /**
   * Generate outline via worker
   */
  const generateOutline = useCallback(async (subject: string, settings: BookSettings, numPages: number): Promise<string> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      const result = await rpcRef.current.send('GENERATE_OUTLINE', {
        subject,
        settings,
        numPages,
      });
      return result as string;
    } catch (err) {
      console.error('Outline generation error:', err);
      throw err;
    }
  }, []);

  /**
   * Start book generation via worker
   */
  const startBookGeneration = useCallback(async (settings: BookSettings, outline: OutlineItem[], numPages: number): Promise<void> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    // Revoke all existing blob URLs to prevent memory leaks when starting a new book
    blobUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('Failed to revoke blob URL:', err);
      }
    });
    blobUrlsRef.current.clear();

    try {
      await rpcRef.current.send('START_GENERATION', {
        settings,
        outline,
        numPages,
      });
    } catch (err) {
      console.error('Failed to start book generation:', err);
      throw err;
    }
  }, []);

  /**
   * Cancel book generation via worker
   */
  const cancelBookGeneration = useCallback(async (): Promise<void> => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      await rpcRef.current.send('CANCEL_GENERATION', {});
    } catch (err) {
      console.error('Failed to cancel generation:', err);
      throw err;
    }
  }, []);

  /**
   * Unload text models via worker
   */
  const unloadTextModel = useCallback(async (): Promise<void> => {
    if (!rpcRef.current) return;

    try {
      await rpcRef.current.send('UNLOAD_MODELS', {
        modelTypes: ['fast', 'quality'],
      });
      setTextModelState(createInitialModelState());
      setQualityTextModelState(createInitialModelState());
      setActiveTextModel('fast');
    } catch (err) {
      console.error('Failed to unload text models:', err);
    }
  }, []);

  /**
   * Unload image model via worker
   */
  const unloadImageModel = useCallback(async (): Promise<void> => {
    if (!rpcRef.current) return;

    try {
      await rpcRef.current.send('UNLOAD_MODELS', {
        modelTypes: ['image'],
      });
      setImageModelState(createInitialModelState());
    } catch (err) {
      console.error('Failed to unload image model:', err);
    }
  }, []);

  /**
   * Unload all models via worker
   */
  const unloadAllModels = useCallback(async (): Promise<void> => {
    if (!rpcRef.current) return;

    try {
      await rpcRef.current.send('UNLOAD_MODELS', {
        modelTypes: ['fast', 'quality', 'image'],
      });
      setTextModelState(createInitialModelState());
      setQualityTextModelState(createInitialModelState());
      setImageModelState(createInitialModelState());
      setActiveTextModel('fast');
    } catch (err) {
      console.error('Failed to unload models:', err);
    }
  }, []);

  /**
   * Get model status via worker
   */
  const getModelStatus = useCallback(async (): Promise<Record<string, string> | null> => {
    if (!rpcRef.current) {
      return null;
    }

    try {
      return await rpcRef.current.send('GET_MODEL_STATUS', {}) as Record<string, string>;
    } catch (err) {
      console.error('Failed to get model status:', err);
      return null;
    }
  }, []);

  /**
   * Retry model initialization after error
   */
  const retryInit = useCallback(async (modelType: 'text' | 'image'): Promise<boolean> => {
    if (modelType === 'text') {
      setTextModelState(prev => ({ ...prev, error: null }));
      return await initTextModel();
    } else if (modelType === 'image') {
      setImageModelState(prev => ({ ...prev, error: null }));
      return await initImageModel();
    }
    return false;
  }, [initTextModel, initImageModel]);

  /**
   * Toggle Speed Mode on/off
   */
  const toggleSpeedMode = useCallback((enabled: boolean) => {
    setSpeedMode(enabled);
  }, []);

  /**
   * Get recommended generation settings based on device resources and speed mode
   */
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

    // If speed mode is manually enabled, use more aggressive optimization
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

  // Actions context value - stable functions that don't change
  const actionsContextValue = useMemo(() => ({
    // Text generation
    generateText,
    generateQuip,
    generateOutline,
    initTextModel,
    unloadTextModel,

    // Image generation
    generateImage: generateImageFromPrompt,
    initImageModel,
    unloadImageModel,

    // Book generation orchestration
    startBookGeneration,
    cancelBookGeneration,

    // General
    unloadAllModels,
    retryInit,
    getModelStatus,

    // Speed Mode and resource management
    toggleSpeedMode,
    getGenerationSettings,

    // Cache management
    fetchCacheStats: getCacheStats,
    clearImageCache: async () => { await clearImageCache(); },

    // Book management
    saveBookToDB: saveBook,
    getSavedBook: getBook,
    getSavedBooks: getAllBooks,
    deleteSavedBook: deleteBook,
  }), [
    generateText,
    generateQuip,
    generateOutline,
    initTextModel,
    unloadTextModel,
    generateImageFromPrompt,
    initImageModel,
    unloadImageModel,
    startBookGeneration,
    cancelBookGeneration,
    unloadAllModels,
    retryInit,
    getModelStatus,
    toggleSpeedMode,
    getGenerationSettings,
    clearImageCache,
  ]);

  // State context value - frequently updating state
  const stateContextValue = useMemo(() => ({
    // Model state
    textModel: textModelState,
    qualityTextModel: qualityTextModelState,
    imageModel: imageModelState,
    activeTextModel,

    // Speed Mode and resources
    speedMode,
    deviceResources,

    // Capabilities
    webgpuCapabilities,
    isWebGPUSupported: !!(webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16),

    // Storage
    storageStatus,
  }), [
    textModelState,
    qualityTextModelState,
    imageModelState,
    activeTextModel,
    speedMode,
    deviceResources,
    webgpuCapabilities,
    storageStatus,
  ]);

  return (
    <ModelActionsContext.Provider value={actionsContextValue}>
      <ModelStateContext.Provider value={stateContextValue}>
        {children}
      </ModelStateContext.Provider>
    </ModelActionsContext.Provider>
  );
};

/**
 * Hook to access model actions context (stable functions)
 * Use this hook in components that don't need progress updates
 */
export const useModelActions = () => {
  const context = useContext(ModelActionsContext);
  if (!context) {
    throw new Error('useModelActions must be used within a ModelProvider');
  }
  return context;
};

/**
 * Hook to access model state context (frequently updating state)
 * Use this hook only in components that need to display progress
 */
export const useModelState = () => {
  const context = useContext(ModelStateContext);
  if (!context) {
    throw new Error('useModelState must be used within a ModelProvider');
  }
  return context;
};

/**
 * Legacy hook that combines both contexts (for backward compatibility)
 * @deprecated Use useModelActions and useModelState separately for better performance
 */
export const useModel = () => {
  const actions = useContext(ModelActionsContext);
  const state = useContext(ModelStateContext);
  if (!actions || !state) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return { ...actions, ...state };
};

export default ModelActionsContext;
