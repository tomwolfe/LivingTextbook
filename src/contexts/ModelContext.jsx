import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { config } from '../config';
import { detectDeviceResources, getRecommendedSettings } from '../utils/resourceDetector';
import { saveBook, getBook, getAllBooks, deleteBook, getCacheStats, clearImageCache } from '../utils/imageCache';
import { MainThreadRPC } from '../utils/workerRPC';
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
 * Model Context - provides AI model state and operations to all consumers
 */
const ModelContext = createContext(null);

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
            const setState = modelType === 'quality' ? setQualityTextModelState : setTextModelState;
            setState(prev => ({
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
            const setState = modelType === 'quality' ? setQualityTextModelState : setTextModelState;
            setState(prev => ({
              ...prev,
              status: ModelStatus.READY,
              loading: false,
              progress: 100,
              device: device || 'WebGPU',
              modelName: modelName || prev.modelName,
            }));
            if (modelType === 'fast' || modelType === 'quality') {
              setActiveTextModel(modelType);
            }
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
            const setState = modelType === 'quality' ? setQualityTextModelState : setTextModelState;
            setState(prev => ({
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
            const setState = modelType === 'quality' ? setQualityTextModelState : setTextModelState;
            setState(createInitialModelState());
          } else if (modelType === 'image') {
            setImageModelState(createInitialModelState());
          }
          break;
        }

        case 'GENERATION_PROGRESS': {
          const { stage, status } = payload || {};
          // Could be used for UI feedback during generation
          console.log(`Generation progress: ${stage} - ${status}`);
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
    const setState = isQuality ? setQualityTextModelState : setTextModelState;

    // Check storage quota before downloading
    try {
      const requirement = modelType === 'quality' ? 'quality' : 'fast';
      await assertStorageAvailability(requirement);
    } catch (err) {
      console.error('Storage check failed:', err);
      setState(prev => ({
        ...prev,
        status: ModelStatus.ERROR,
        loading: false,
        error: `Insufficient storage: ${err.message}`,
      }));
      return false;
    }

    setState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const result = await rpcRef.current.send('INIT_MODELS', {
        modelTypes: [modelType],
      });

      return result[modelType]?.success || false;
    } catch (err) {
      console.error('Failed to initialize text model:', err);
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
    const setState = isQuality ? setQualityTextModelState : setTextModelState;

    if (!skipStatus) {
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
        setState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
      }

      return result;
    } catch (err) {
      console.error('Text generation error:', err);
      if (!skipStatus) {
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

      if (result?.imageUrl) {
        setImageModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
        return result;
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
   * Resume book generation via worker
   */
  const resumeBookGeneration = useCallback(async () => {
    if (!rpcRef.current) {
      throw new Error('Worker not initialized');
    }

    try {
      await rpcRef.current.send('RESUME_GENERATION');
    } catch (err) {
      console.error('Failed to resume generation:', err);
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

  // Context value - memoized to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    // Text generation
    generateText,
    generateQuip,
    generateOutline,
    textModel: textModelState,
    qualityTextModel: qualityTextModelState,
    activeTextModel,
    initTextModel,
    unloadTextModel,

    // Image generation
    generateImage: generateImageFromPrompt,
    imageModel: imageModelState,
    initImageModel,
    unloadImageModel,

    // Book generation orchestration
    startBookGeneration,
    resumeBookGeneration,
    cancelBookGeneration,

    // General
    unloadAllModels,
    retryInit,
    getModelStatus,

    // Speed Mode and resource management
    speedMode,
    toggleSpeedMode,
    getGenerationSettings,
    deviceResources,

    // Cache management
    fetchCacheStats: getCacheStats,
    clearImageCache,

    // Storage management
    storageStatus,

    // Book management
    saveBookToDB: saveBook,
    getSavedBook: getBook,
    getSavedBooks: getAllBooks,
    deleteSavedBook: deleteBook,

    // Capabilities
    webgpuCapabilities,
    isWebGPUSupported: webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16,
  }), [
    generateText,
    generateQuip,
    generateOutline,
    textModelState,
    qualityTextModelState,
    activeTextModel,
    initTextModel,
    unloadTextModel,
    generateImageFromPrompt,
    imageModelState,
    initImageModel,
    unloadImageModel,
    startBookGeneration,
    resumeBookGeneration,
    cancelBookGeneration,
    unloadAllModels,
    retryInit,
    getModelStatus,
    speedMode,
    toggleSpeedMode,
    getGenerationSettings,
    deviceResources,
    clearImageCache,
    storageStatus,
    webgpuCapabilities,
  ]);

  return <ModelContext.Provider value={contextValue}>{children}</ModelContext.Provider>;
};

/**
 * Hook to access model context
 */
export const useModel = () => {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
};

export default ModelContext;
