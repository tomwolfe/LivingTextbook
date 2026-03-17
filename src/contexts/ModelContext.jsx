import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { pipeline, env, AutoTokenizer } from '@huggingface/transformers';
import { loadModel, generateImage, unloadModel, detectCapabilities } from 'web-txt2img';
import { config } from '../config';
import { detectDeviceResources, getRecommendedSettings } from '../utils/resourceDetector';
import { cacheImage, getCachedImage, saveBook, getBook, getAllBooks, deleteBook } from '../utils/imageCache';

// Configure transformers.js environment
env.allowLocalModels = config.transformers.allowLocalModels;
env.useBrowserCache = config.transformers.useBrowserCache;
env.logLevel = config.transformers.logLevel;

/**
 * Model Status Enum
 */
// eslint-disable-next-line react-refresh/only-export-components
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
// eslint-disable-next-line react-refresh/only-export-components
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
});

/**
 * Model Context - provides AI model state and operations to all consumers
 */
const ModelContext = createContext(null);

/**
 * Provider component that manages AI model lifecycle
 */
export const ModelProvider = ({ children }) => {
  // Text generation model state (fast model - SmolLM2)
  const [textModelState, setTextModelState] = useState(createInitialModelState());
  const textGenerator = useRef(null);

  // Quality text generation model state (Qwen2.5)
  const [qualityTextModelState, setQualityTextModelState] = useState(createInitialModelState());
  const qualityTextGenerator = useRef(null);

  // Track which model is currently active
  const [activeTextModel, setActiveTextModel] = useState('fast'); // 'fast' or 'quality'

  // Image generation model state
  const [imageModelState, setImageModelState] = useState(createInitialModelState());
  const imageModelLoaded = useRef(false);
  const imageModelLoadPromise = useRef(null);

  // WebGPU capability state
  const [webgpuCapabilities, setWebgpuCapabilities] = useState(null);

  // Device resource state for Speed Mode
  const [deviceResources, setDeviceResources] = useState(null);
  const [speedMode, setSpeedMode] = useState(false);

  /**
   * Detect WebGPU capabilities and device resources on mount
   */
  useEffect(() => {
    const detectCaps = async () => {
      try {
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
   * Progress callback factory for text generation
   */
  const createTextProgressCallback = useCallback((setState) => (progress) => {
    if (progress?.status === 'progress') {
      setState(prev => ({
        ...prev,
        progress: parseFloat(progress.progress?.toFixed(2) || 0),
      }));
    }
  }, []);

  /**
   * Initialize a text generation model (fast or quality)
   */
  const initTextModel = useCallback(async (modelType = 'fast') => {
    const isQuality = modelType === 'quality';
    const generatorRef = isQuality ? qualityTextGenerator : textGenerator;
    const setState = isQuality ? setQualityTextModelState : setTextModelState;

    if (generatorRef.current) {
      return true;
    }

    setState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const progressCallback = createTextProgressCallback(setState);
      
      // Get model IDs based on type
      const webgpuModelId = isQuality ? config.textGen.qualityModelId : config.textGen.fastModelId;
      const cpuModelId = isQuality ? config.textGen.qualityModelIdCPU : config.textGen.fastModelIdCPU;
      const modelName = isQuality ? 'Qwen2.5-0.5B' : 'SmolLM2-135M';

      // Try WebGPU first
      try {
        generatorRef.current = await pipeline(
          'text-generation',
          webgpuModelId,
          {
            device: 'webgpu',
            progress_callback: progressCallback,
          }
        );
        setState(prev => ({
          ...prev,
          status: ModelStatus.READY,
          loading: false,
          device: 'WebGPU',
          modelName,
        }));
        return true;
      } catch (webgpuErr) {
        console.warn('WebGPU not available, falling back to CPU:', webgpuErr);

        // Fallback to CPU
        generatorRef.current = await pipeline(
          'text-generation',
          cpuModelId,
          {
            progress_callback: progressCallback,
          }
        );
        setState(prev => ({
          ...prev,
          status: ModelStatus.READY,
          loading: false,
          device: 'CPU',
          modelName,
        }));
        return true;
      }
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
  }, [createTextProgressCallback]);

  /**
   * Initialize image generation model
   */
  const initImageModel = useCallback(async () => {
    if (imageModelLoaded.current) {
      return true;
    }

    setImageModelState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      // Check WebGPU capabilities
      if (!webgpuCapabilities?.webgpu || !webgpuCapabilities?.shaderF16) {
        throw new Error('WebGPU with shader_f16 support is required for image generation');
      }

      // Create tokenizer provider
      const tokenizerProvider = async () => {
        const tokenizer = await AutoTokenizer.from_pretrained(config.imageGen.tokenizerModel);
        tokenizer.pad_token_id = 0;
        return async (text) => {
          // Tokenize the text
          const tokens = await tokenizer.encode(text, {
            truncation: true,
            max_length: 77,
          });
          
          // Get the token IDs array
          let tokenIds = tokens;
          if (typeof tokens === 'object' && tokens !== null) {
            tokenIds = tokens.input_ids || tokens;
          }
          
          // Convert to array if it's a tensor
          if (!Array.isArray(tokenIds)) {
            tokenIds = tokenIds.tolist?.() || [...tokenIds];
          }
          
          // Pad to exactly 77 tokens
          while (tokenIds.length < 77) {
            tokenIds.push(0); // pad_token_id
          }
          
          // Truncate if somehow longer than 77
          if (tokenIds.length > 77) {
            tokenIds = tokenIds.slice(0, 77);
          }
          
          return { input_ids: tokenIds };
        };
      };

      // Load model
      imageModelLoadPromise.current = loadModel(
        config.imageGen.modelId,
        {
          backendPreference: ['webgpu'],
          tokenizerProvider,
        },
        (progress) => {
          const pct = progress.pct != null ? Math.round(progress.pct) : null;
          setImageModelState(prev => ({
            ...prev,
            progress: pct != null ? pct : prev.progress,
          }));
        }
      );

      const loadResult = await imageModelLoadPromise.current;

      if (!loadResult?.ok) {
        throw new Error(loadResult?.message || 'Model load failed');
      }

      imageModelLoaded.current = true;
      setImageModelState(prev => ({
        ...prev,
        status: ModelStatus.READY,
        loading: false,
        device: 'WebGPU',
      }));
      return true;
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
  }, [webgpuCapabilities]);

  /**
   * Determine which model to use based on complexity
   */
  const getModelTypeForComplexity = useCallback((complexity = 0.5) => {
    // Use quality model for high complexity content
    return complexity >= config.textGen.complexityThreshold ? 'quality' : 'fast';
  }, []);

  /**
   * Generate text from a prompt
   */
  const generateText = useCallback(async (prompt, options = {}) => {
    const { complexity, skipStatus, ...generationOptions } = options;
    
    // Determine which model to use based on complexity
    const modelType = getModelTypeForComplexity(complexity);
    const isQuality = modelType === 'quality';
    const generatorRef = isQuality ? qualityTextGenerator : textGenerator;
    const setState = isQuality ? setQualityTextModelState : setTextModelState;

    // Initialize the appropriate model
    if (!generatorRef.current) {
      const success = await initTextModel(modelType);
      if (!success) {
        return null;
      }
    }

    // Update active model tracking
    setActiveTextModel(modelType);

    if (!skipStatus) {
      setState(prev => ({ ...prev, loading: true, status: 'Generating Content...' }));
    }

    try {
      const messages = [
        { role: 'system', content: options.systemPrompt || 'You are a helpful educational assistant.' },
        { role: 'user', content: prompt },
      ];

      const output = await generatorRef.current(messages, {
        max_new_tokens: generationOptions.maxTokens || config.textGen.maxNewTokens,
        temperature: generationOptions.temperature || config.textGen.temperature,
        do_sample: generationOptions.doSample ?? config.textGen.doSample,
      });

      if (!skipStatus) {
        setState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
      }

      // Extract content from chat format
      const content = output[0]?.generated_text?.[output[0].generated_text.length - 1]?.content;
      return content || 'No content generated.';
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
  }, [initTextModel, getModelTypeForComplexity]);

  /**
   * Generate a witty quip from the narrator
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
   * Generate image from a prompt
   */
  const generateImageFromPrompt = useCallback(async (prompt, options = {}) => {
    const { skipCache = false, useCache = true, negativePrompt } = options;

    // Check cache first (unless disabled)
    // Use negative prompt as part of cache key if provided
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

    if (!imageModelLoaded.current) {
      const success = await initImageModel();
      if (!success) {
        return null;
      }
    }

    // Wait for any ongoing load
    if (imageModelLoadPromise.current) {
      await imageModelLoadPromise.current;
    }

    if (!imageModelLoaded.current) {
      return null;
    }

    setImageModelState(prev => ({ ...prev, loading: true, status: 'Generating Image...' }));

    try {
      // Get generation settings based on device resources
      const genSettings = getGenerationSettings();

      const generateImageParams = {
        model: config.imageGen.modelId,
        prompt,
        seed: Math.floor(Math.random() * (config.imageGen.seedRange.max - config.imageGen.seedRange.min) + config.imageGen.seedRange.min),
        width: genSettings.imageResolution?.width || config.imageGen.width,
        height: genSettings.imageResolution?.height || config.imageGen.height,
      };

      // Add negative prompt if supported and provided
      if (negativePrompt) {
        generateImageParams.negativePrompt = negativePrompt;
      }

      const result = await generateImage(generateImageParams);

      if (result?.ok && result?.blob) {
        // Cache the generated image (use combined key if negative prompt)
        await cacheImage(cachePrompt, result.blob, {
          width: result.blob.width,
          height: result.blob.height,
          seed: result.seed,
          negativePrompt,
        });

        const imageUrl = URL.createObjectURL(result.blob);
        setImageModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
        return { imageUrl, blob: result.blob, cached: false };
      } else {
        throw new Error(result?.message || 'Generation failed');
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
  }, [initImageModel]);

  /**
   * Unload text models to free memory
   */
  const unloadTextModel = useCallback(async () => {
    if (textGenerator.current) {
      textGenerator.current = null;
      setTextModelState(createInitialModelState());
    }
    if (qualityTextGenerator.current) {
      qualityTextGenerator.current = null;
      setQualityTextModelState(createInitialModelState());
    }
    setActiveTextModel('fast');
  }, []);

  /**
   * Unload image model to free memory
   */
  const unloadImageModel = useCallback(async () => {
    if (imageModelLoaded.current) {
      await unloadModel(config.imageGen.modelId);
      imageModelLoaded.current = false;
      imageModelLoadPromise.current = null;
      setImageModelState(createInitialModelState());
    }
  }, []);

  /**
   * Unload all models
   */
  const unloadAllModels = useCallback(async () => {
    await unloadTextModel();
    await unloadImageModel();
  }, [unloadTextModel, unloadImageModel]);

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

  /**
   * Get image cache statistics
   */
  const fetchCacheStats = useCallback(async () => {
    const { getCacheStats: getStats } = await import('../utils/imageCache');
    return await getStats();
  }, []);

  /**
   * Clear the image cache
   */
  const clearImageCache = useCallback(async () => {
    const { clearImageCache: clearCache } = await import('../utils/imageCache');
    return await clearCache();
  }, []);

  /**
   * Save a book to IndexedDB
   */
  const saveBookToDB = useCallback(async (bookData) => {
    return await saveBook(bookData);
  }, []);

  /**
   * Get a saved book by ID
   */
  const getSavedBook = useCallback(async (bookId) => {
    return await getBook(bookId);
  }, []);

  /**
   * Get all saved books
   */
  const getSavedBooks = useCallback(async () => {
    return await getAllBooks();
  }, []);

  /**
   * Delete a saved book
   */
  const deleteSavedBook = useCallback(async (bookId) => {
    return await deleteBook(bookId);
  }, []);

  // Context value - memoized to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    // Text generation
    generateText,
    generateQuip,
    textModel: textModelState,
    qualityTextModel: qualityTextModelState,
    activeTextModel,
    initTextModel,
    unloadTextModel,
    getModelTypeForComplexity,

    // Image generation
    generateImage: generateImageFromPrompt,
    imageModel: imageModelState,
    initImageModel,
    unloadImageModel,

    // General
    unloadAllModels,
    retryInit,

    // Speed Mode and resource management
    speedMode,
    toggleSpeedMode,
    getGenerationSettings,
    deviceResources,

    // Cache management
    fetchCacheStats,
    clearImageCache,

    // Book management
    saveBookToDB,
    getSavedBook,
    getSavedBooks,
    deleteSavedBook,

    // Capabilities
    webgpuCapabilities,
    isWebGPUSupported: webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16,
  }), [
    generateText,
    generateQuip,
    textModelState,
    qualityTextModelState,
    activeTextModel,
    initTextModel,
    unloadTextModel,
    getModelTypeForComplexity,
    generateImageFromPrompt,
    imageModelState,
    initImageModel,
    unloadImageModel,
    unloadAllModels,
    retryInit,
    speedMode,
    toggleSpeedMode,
    getGenerationSettings,
    deviceResources,
    fetchCacheStats,
    clearImageCache,
    saveBookToDB,
    getSavedBook,
    getSavedBooks,
    deleteSavedBook,
    webgpuCapabilities,
  ]);

  return <ModelContext.Provider value={contextValue}>{children}</ModelContext.Provider>;
};

/**
 * Hook to access model context
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useModel = () => {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
};

export default ModelContext;
