import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { pipeline, env, AutoTokenizer } from '@huggingface/transformers';
import { loadModel, generateImage, unloadModel, detectCapabilities } from 'web-txt2img';
import { config } from '../config';

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
  // Text generation model state
  const [textModelState, setTextModelState] = useState(createInitialModelState());
  const textGenerator = useRef(null);

  // Image generation model state
  const [imageModelState, setImageModelState] = useState(createInitialModelState());
  const imageModelLoaded = useRef(false);
  const imageModelLoadPromise = useRef(null);

  // WebGPU capability state
  const [webgpuCapabilities, setWebgpuCapabilities] = useState(null);

  /**
   * Detect WebGPU capabilities once on mount
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
    detectCaps();
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
   * Initialize text generation model
   */
  const initTextModel = useCallback(async () => {
    if (textGenerator.current) {
      return true;
    }

    setTextModelState(prev => ({ ...prev, status: ModelStatus.LOADING, loading: true, error: null }));

    try {
      const progressCallback = createTextProgressCallback(setTextModelState);

      // Try WebGPU first
      try {
        textGenerator.current = await pipeline(
          'text-generation',
          config.textGen.modelIdWebGPU,
          {
            device: 'webgpu',
            progress_callback: progressCallback,
          }
        );
        setTextModelState(prev => ({
          ...prev,
          status: ModelStatus.READY,
          loading: false,
          device: 'WebGPU',
        }));
        return true;
      } catch (webgpuErr) {
        console.warn('WebGPU not available, falling back to CPU:', webgpuErr);

        // Fallback to CPU
        textGenerator.current = await pipeline(
          'text-generation',
          config.textGen.modelIdCPU,
          {
            progress_callback: progressCallback,
          }
        );
        setTextModelState(prev => ({
          ...prev,
          status: ModelStatus.READY,
          loading: false,
          device: 'CPU',
        }));
        return true;
      }
    } catch (err) {
      console.error('Failed to initialize text model:', err);
      setTextModelState(prev => ({
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
   * Generate text from a prompt
   */
  const generateText = useCallback(async (prompt) => {
    if (!textGenerator.current) {
      const success = await initTextModel();
      if (!success) {
        return null;
      }
    }

    setTextModelState(prev => ({ ...prev, loading: true, status: 'Generating Content...' }));

    try {
      const messages = [
        { role: 'system', content: 'You are a helpful educational assistant.' },
        { role: 'user', content: prompt },
      ];

      const output = await textGenerator.current(messages, {
        max_new_tokens: config.textGen.maxNewTokens,
        temperature: config.textGen.temperature,
        do_sample: config.textGen.doSample,
      });

      setTextModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));

      // Extract content from chat format
      const content = output[0]?.generated_text?.[output[0].generated_text.length - 1]?.content;
      return content || 'No content generated.';
    } catch (err) {
      console.error('Text generation error:', err);
      setTextModelState(prev => ({
        ...prev,
        loading: false,
        status: ModelStatus.ERROR,
        error: err.message || 'Generation failed',
      }));
      return null;
    }
  }, [initTextModel]);

  /**
   * Generate image from a prompt
   */
  const generateImageFromPrompt = useCallback(async (prompt) => {
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
      const result = await generateImage({
        model: config.imageGen.modelId,
        prompt,
        seed: Math.floor(Math.random() * (config.imageGen.seedRange.max - config.imageGen.seedRange.min) + config.imageGen.seedRange.min),
        width: config.imageGen.width,
        height: config.imageGen.height,
      });

      if (result?.ok && result?.blob) {
        const imageUrl = URL.createObjectURL(result.blob);
        setImageModelState(prev => ({ ...prev, loading: false, status: ModelStatus.READY }));
        return imageUrl;
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
   * Unload text model to free memory
   */
  const unloadTextModel = useCallback(async () => {
    if (textGenerator.current) {
      // Transformers.js doesn't have a direct unload API for pipeline
      textGenerator.current = null;
      setTextModelState(createInitialModelState());
    }
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

  // Context value
  const contextValue = {
    // Text generation
    generateText,
    textModel: textModelState,
    initTextModel,
    unloadTextModel,

    // Image generation
    generateImage: generateImageFromPrompt,
    imageModel: imageModelState,
    initImageModel,
    unloadImageModel,

    // General
    unloadAllModels,
    retryInit,

    // Capabilities
    webgpuCapabilities,
    isWebGPUSupported: webgpuCapabilities?.webgpu && webgpuCapabilities?.shaderF16,
  };

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
