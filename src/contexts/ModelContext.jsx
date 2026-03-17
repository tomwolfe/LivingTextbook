import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { config } from '../config';
import { detectDeviceResources, getRecommendedSettings } from '../utils/resourceDetector.ts';
import { saveBook, getBook, getAllBooks, deleteBook, getCacheStats, clearImageCache } from '../utils/imageCache.ts';
import { MainThreadRPC } from '../utils/workerRPC.ts';
import { assertStorageAvailability, MODEL_SIZES } from '../utils/storageQuota';

/**
 * Model Status Enum
 */
export const ModelStatus = {
  IDLE: 'Idle',
  LOADING: 'Loading',
  READY: 'Ready',
  ERROR: 'Error',
  UNLOADED: 'Unloaded',
};

/**
 * Model Type Enum
 */
export const ModelType = {
  TEXT: 'text',
  IMAGE: 'image',
};

/**
 * Initial state for a model
 */
const createInitialModelState = () => ({
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
export const ModelActionsContext = createContext(null);

/**
 * Model State Context - provides frequently updating state
 * Only components that need to display progress should consume this
 */
export const ModelStateContext = createContext(null);

/**
 * Provider component that manages AI model lifecycle via worker
 */
export const ModelProvider = ({ children }) => {
  // Text generation model state (fast model - SmolLM2)
  const [textModelState, setTextModelState] = useState(createInitialModelState());

  // Quality text generation model state (Qwen2.5)
  const [qualityTextModelState, setQualityTextModelState] = useState(createInitialModelState());

  // Track which model is currently active
  const [activeTextModel, setActiveTextModel] = useState('fast'); // 'fast' or 'quality'

  // Image generation model state
  const [imageModelState, setImageModelState] = useState(createInitialModelState());

  // WebGPU capability state
  const [webgpuCapabilities, setWebgpuCapabilities] = useState(null);

  // Device resource state for Speed Mode
  const [deviceResources, setDeviceResources] = useState(null);
  const [speedMode, setSpeedMode] = useState(false);

  // Storage quota state
  const [storageStatus, setStorageStatus] = useState(null);

  // Worker and RPC
  const workerRef = useRef(null);
  const rpcRef = useRef(null);
  // Track blob URLs to prevent memory leaks
  const blobUrlsRef = useRef(new Set());

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
        setStorageStatus(status);
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
      const { type, payload } = data;

      switch (type) {
        case 'MODEL_PROGRESS': {
          const { modelType, progress, status } = payload || {};
          if (modelType === 'fast' || modelType === 'quality') {
            setQualityTextModelState(prev => ({
              ...prev,
              progress,
              status: status || prev.status,
              loading: progress < 100,
            }));
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              progress,
              status: status || prev.status,
              loading: progress < 100,
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
              device: device || 'WebGPU',
              modelName: modelName || prev.modelName,
            }));
            setActiveTextModel(modelType);
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              status: ModelStatus.READY,
              loading: false,
              progress: 100,
              device: device || 'WebGPU',
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
              error: error || 'Model load failed',
            }));
          } else if (modelType === 'image') {
            setImageModelState(prev => ({
              ...prev,
              status: ModelStatus.ERROR,
              loading: false,
              error: error || 'Model load failed',
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
          const { stage, status } = payload || {};
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
  const initTextModel = useCallback(async (modelType = 'fast') => {
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
        error: `Insufficient storage: ${err.message}`,
      }));
      return false;
    }

    const setState = isQuality ? setQualityTextModelState : setTextModelState;
    setState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const result = await rpcRef.current.send('INIT_MODELS', {
        modelTypes: [modelType],
      });

      return result[modelType]?.success || false;
    } catch (err) {
      console.error('Failed to initialize text model:', err);
      const setState = isQuality ? setQualityTextModelState : setTextModelState;
      setState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: err.message || 'Failed to load text model',
      }));
      return false;
    }
  }, []);

  /**
   * Initialize image model via worker
   */
  const initImageModel = useCallback(async () => {
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
        error: `Insufficient storage: ${err.message}`,
      }));
      return false;
    }

    setImageModelState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const result = await rpcRef.current.send('INIT_MODELS', {
        modelTypes: ['image'],
      });
      return result.image?.success || false;
    } catch (err) {
      console.error('Failed to initialize image model:', err);
      setImageModelState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: err.message || 'Failed to load image model',
      }));
      return false;
    }
  }, []);

  /**
   * Generate text from a prompt via worker
   */
  const generateText = useCallback(async (prompt, options = {}) => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    const { complexity, skipStatus, ...generationOptions } = options;
    const isQuality = complexity >= config.textGen.complexityThreshold;

    if (!skipStatus) {
      const setState = isQuality ? setQualityTextModelState : setTextModelState;
      setState(prev => ({ ...prev, loading: true, status: 'Generating Content...' }));
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

      return result;
    } catch (err) {
      console.error('Text generation error:', err);
      if (!skipStatus) {
        const setState = isQuality ? setQualityTextModelState : setTextModelState;
        setState(prev => ({
          ...prev,
          loading: false,
          status: ModelStatus.ERROR,
          error: err.message || 'Generation failed',
        }));
      }
      return null;
    }
  }, []);

  /**
   * Generate a witty quip via worker
   */
  const generateQuip = useCallback(async (content) => {
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
  const generateImageFromPrompt = useCallback(async (prompt, options = {}) => {
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

    setImageModelState(prev => ({ ...prev, loading: true, status: 'Generating Image...' }));

    try {
      const result = await rpcRef.current.send('GENERATE_IMAGE', {
        prompt,
        options: { negativePrompt, useCache: false }, // Cache already checked above
      });

      // Worker returns ArrayBuffer - reconstruct blob on main thread
      if (result?.blob) {
        const blob = new Blob([result.blob], { type: result.type || 'image/png' });
        const imageUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.add(imageUrl);

        setImageModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
        return { imageUrl, blob, cached: result.cached || false };
      } else {
        throw new Error('Image generation failed');
      }
    } catch (err) {
      console.error('Image generation error:', err);
      setImageModelState(prev => ({
        ...prev,
        loading: false,
        status: ModelStatus.ERROR,
        error: err.message || 'Image generation failed',
      }));
      return null;
    }
  }, []);

  /**
   * Generate outline via worker
   */
  const generateOutline = useCallback(async (subject, settings, numPages) => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      const result = await rpcRef.current.send('GENERATE_OUTLINE', {
        subject,
        settings,
        numPages,
      });
      return result;
    } catch (err) {
      console.error('Outline generation error:', err);
      throw err;
    }
  }, []);

  /**
   * Start book generation via worker
   */
  const startBookGeneration = useCallback(async (settings, outline, numPages) => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      const result = await rpcRef.current.send('START_GENERATION', {
        settings,
        outline,
        numPages,
      });
      return result;
    } catch (err) {
      console.error('Failed to start book generation:', err);
      throw err;
    }
  }, []);

  /**
   * Cancel book generation via worker
   */
  const cancelBookGeneration = useCallback(async () => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      await rpcRef.current.send('CANCEL_GENERATION');
    } catch (err) {
      console.error('Failed to cancel generation:', err);
      throw err;
    }
  }, []);

  /**
   * Unload text models via worker
   */
  const unloadTextModel = useCallback(async () => {
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
  const unloadImageModel = useCallback(async () => {
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
  const unloadAllModels = useCallback(async () => {
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
  const getModelStatus = useCallback(async () => {
    if (!rpcRef.current) {
      return null;
    }

    try {
      return await rpcRef.current.send('GET_MODEL_STATUS');
    } catch (err) {
      console.error('Failed to get model status:', err);
      return null;
    }
  }, []);

  /**
   * Retry model initialization after error
   */
  const retryInit = useCallback(async (modelType) => {
    if (modelType === ModelType.TEXT) {
      setTextModelState(prev => ({ ...prev, error: null }));
      return await initTextModel();
    } else if (modelType === ModelType.IMAGE) {
      setImageModelState(prev => ({ ...prev, error: null }));
      return await initImageModel();
    }
    return false;
  }, [initTextModel, initImageModel]);

  /**
   * Toggle Speed Mode on/off
   */
  const toggleSpeedMode = useCallback((enabled) => {
    setSpeedMode(enabled);
  }, []);

  /**
   * Get recommended generation settings based on device resources and speed mode
   */
  const getGenerationSettings = useCallback(() => {
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
    clearImageCache,

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
    isWebGPUSupported: webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16,

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
