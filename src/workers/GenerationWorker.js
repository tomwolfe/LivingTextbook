/**
 * GenerationWorker - Handles ALL AI model operations off the main thread
 * 
 * This worker now contains the complete AI inference logic:
 * - Text generation (SmolLM2, Qwen2.5)
 * - Image generation (SD-Turbo)
 * - Model lifecycle management
 * - Book generation orchestration
 * 
 * Communication uses UUID-based RPC to prevent race conditions.
 */

import { pipeline, env, AutoTokenizer } from '@huggingface/transformers';
import { loadModel, generateImage, unloadModel, detectCapabilities } from 'web-txt2img';
import { config } from '../config.js';
import { generatePrompt, generateOutlinePrompt, generateQuipPrompt } from '../utils/promptEngine.ts';
import { WorkerRPC } from '../utils/workerRPC.ts';
import { cacheImage, getCachedImage } from '../utils/imageCache.ts';

// Configure transformers.js environment
env.allowLocalModels = config.transformers.allowLocalModels;
env.useBrowserCache = config.transformers.useBrowserCache;
env.logLevel = config.transformers.logLevel;

// Initialize RPC handler
const rpc = new WorkerRPC();

// Model state
const modelState = {
  textGenerator: null,
  qualityTextGenerator: null,
  imageModelLoaded: false,
  imageModelLoadPromise: null,
  activeTextModel: 'fast',
};

// Generation session state
let generationQueue = [];
let isGenerating = false;
let currentSettings = null;
let currentNumPages = 0;
let generatedPages = [];

/**
 * Initialize text generation model (fast or quality)
 */
async function initTextModel(modelType = 'fast') {
  const isQuality = modelType === 'quality';
  const generatorRef = isQuality ? modelState.qualityTextGenerator : modelState.textGenerator;
  
  if (generatorRef) {
    return { success: true, device: 'cached' };
  }

  try {
    const modelId = isQuality ? config.textGen.qualityModelId : config.textGen.fastModelId;
    const cpuModelId = isQuality ? config.textGen.qualityModelIdCPU : config.textGen.fastModelIdCPU;
    const modelName = isQuality ? 'Qwen2.5-0.5B' : 'SmolLM2-135M';

    // Progress callback
    const progressCallback = (progress) => {
      if (progress?.status === 'progress') {
        rpc.sendEvent('MODEL_PROGRESS', {
          modelType: isQuality ? 'quality' : 'fast',
          progress: parseFloat(progress.progress?.toFixed(2) || 0),
          status: `Loading ${modelName}...`,
        });
      }
    };

    // Try WebGPU first
    try {
      const generator = await pipeline(
        'text-generation',
        modelId,
        {
          device: 'webgpu',
          progress_callback: progressCallback,
        }
      );
      
      if (isQuality) {
        modelState.qualityTextGenerator = generator;
      } else {
        modelState.textGenerator = generator;
      }
      
      modelState.activeTextModel = modelType;
      
      rpc.sendEvent('MODEL_LOADED', {
        modelType: isQuality ? 'quality' : 'fast',
        device: 'WebGPU',
        modelName,
      });
      
      return { success: true, device: 'WebGPU', modelName };
    } catch (webgpuErr) {
      console.warn('WebGPU not available, falling back to CPU:', webgpuErr);

      // Fallback to CPU
      const generator = await pipeline(
        'text-generation',
        cpuModelId,
        {
          progress_callback: progressCallback,
        }
      );
      
      if (isQuality) {
        modelState.qualityTextGenerator = generator;
      } else {
        modelState.textGenerator = generator;
      }
      
      modelState.activeTextModel = modelType;
      
      rpc.sendEvent('MODEL_LOADED', {
        modelType: isQuality ? 'quality' : 'fast',
        device: 'CPU',
        modelName,
      });
      
      return { success: true, device: 'CPU', modelName };
    }
  } catch (err) {
    console.error('Failed to initialize text model:', err);
    rpc.sendEvent('MODEL_ERROR', {
      modelType: isQuality ? 'quality' : 'fast',
      error: err.message || 'Failed to load text model',
    });
    return { success: false, error: err.message };
  }
}

/**
 * Initialize image generation model
 */
async function initImageModel() {
  if (modelState.imageModelLoaded) {
    return { success: true };
  }

  try {
    // Check WebGPU capabilities
    const caps = await detectCapabilities();
    if (!caps?.webgpu || !caps?.shaderF16) {
      throw new Error('WebGPU with shader_f16 support is required for image generation');
    }

    rpc.sendEvent('MODEL_PROGRESS', {
      modelType: 'image',
      progress: 0,
      status: 'Loading SD-Turbo...',
    });

    // Create tokenizer provider
    const tokenizerProvider = async () => {
      const tokenizer = await AutoTokenizer.from_pretrained(config.imageGen.tokenizerModel);
      tokenizer.pad_token_id = 0;
      return async (text) => {
        const tokens = await tokenizer.encode(text, {
          truncation: true,
          max_length: 77,
        });

        let tokenIds = tokens;
        if (typeof tokens === 'object' && tokens !== null) {
          tokenIds = tokens.input_ids || tokens;
        }

        if (!Array.isArray(tokenIds)) {
          tokenIds = tokenIds.tolist?.() || [...tokenIds];
        }

        while (tokenIds.length < 77) {
          tokenIds.push(0);
        }

        if (tokenIds.length > 77) {
          tokenIds = tokenIds.slice(0, 77);
        }

        return { input_ids: tokenIds };
      };
    };

    // Load model
    modelState.imageModelLoadPromise = loadModel(
      config.imageGen.modelId,
      {
        backendPreference: ['webgpu'],
        tokenizerProvider,
      },
      (progress) => {
        const pct = progress.pct != null ? Math.round(progress.pct) : null;
        if (pct != null) {
          rpc.sendEvent('MODEL_PROGRESS', {
            modelType: 'image',
            progress: pct,
            status: `Loading SD-Turbo... ${pct}%`,
          });
        }
      }
    );

    const loadResult = await modelState.imageModelLoadPromise;

    if (!loadResult?.ok) {
      throw new Error(loadResult?.message || 'Model load failed');
    }

    modelState.imageModelLoaded = true;
    
    rpc.sendEvent('MODEL_LOADED', {
      modelType: 'image',
      device: 'WebGPU',
    });
    
    return { success: true };
  } catch (err) {
    console.error('Failed to initialize image model:', err);
    rpc.sendEvent('MODEL_ERROR', {
      modelType: 'image',
      error: err.message || 'Failed to load image model',
    });
    return { success: false, error: err.message };
  }
}

/**
 * Generate text from a prompt
 */
async function generateText(prompt, options = {}) {
  const { complexity = 0.5, maxTokens, temperature, systemPrompt } = options;
  
  // Determine which model to use based on complexity
  const modelType = complexity >= config.textGen.complexityThreshold ? 'quality' : 'fast';
  
  // Initialize the appropriate model
  const initResult = await initTextModel(modelType);
  if (!initResult.success) {
    throw new Error(initResult.error || 'Text model not initialized');
  }

  const generator = modelType === 'quality' 
    ? modelState.qualityTextGenerator 
    : modelState.textGenerator;

  if (!generator) {
    throw new Error('Text generator not available');
  }

  try {
    rpc.sendEvent('GENERATION_PROGRESS', {
      stage: 'text',
      status: 'Generating content...',
    });

    const messages = [
      { role: 'system', content: systemPrompt || 'You are a helpful educational assistant.' },
      { role: 'user', content: prompt },
    ];

    const output = await generator(messages, {
      max_new_tokens: maxTokens || config.textGen.maxNewTokens,
      temperature: temperature || config.textGen.temperature,
      do_sample: options.doSample ?? config.textGen.doSample,
    });

    // Extract content from chat format
    const content = output[0]?.generated_text?.[output[0].generated_text.length - 1]?.content;
    
    return content || 'No content generated.';
  } catch (err) {
    console.error('Text generation error:', err);
    throw err;
  }
}

/**
 * Generate a witty quip
 */
async function generateQuip(content) {
  try {
    const quip = await generateText(content, {
      systemPrompt: 'You are Logic the Lemur, a sassy, playful character who breaks the fourth wall.',
      maxTokens: 50,
      temperature: 0.9,
    });
    return quip;
  } catch (err) {
    console.warn('Failed to generate quip:', err);
    return null;
  }
}

/**
 * Generate image from a prompt
 */
async function generateImageFromPrompt(prompt, options = {}) {
  const { useCache = true, negativePrompt } = options;

  // Check cache first
  const cachePrompt = negativePrompt ? `${prompt}|${negativePrompt}` : prompt;
  if (useCache) {
    try {
      const cachedBlob = await getCachedImage(cachePrompt);
      if (cachedBlob) {
        console.log('[ImageCache] Hit for prompt:', prompt.substring(0, 50));
        // Convert blob to ArrayBuffer for transfer
        const arrayBuffer = await cachedBlob.arrayBuffer();
        return { 
          blob: arrayBuffer, 
          type: cachedBlob.type, 
          cached: true 
        };
      }
    } catch (err) {
      console.warn('[ImageCache] Failed to get cached image:', err);
    }
  }

  // Initialize image model
  const initResult = await initImageModel();
  if (!initResult.success) {
    throw new Error(initResult.error || 'Image model not initialized');
  }

  // Wait for any ongoing load
  if (modelState.imageModelLoadPromise) {
    await modelState.imageModelLoadPromise;
  }

  if (!modelState.imageModelLoaded) {
    throw new Error('Image model failed to load');
  }

  try {
    rpc.sendEvent('GENERATION_PROGRESS', {
      stage: 'image',
      status: 'Generating image...',
    });

    const generateImageParams = {
      model: config.imageGen.modelId,
      prompt,
      seed: Math.floor(Math.random() * (config.imageGen.seedRange.max - config.imageGen.seedRange.min) + config.imageGen.seedRange.min),
      width: config.imageGen.width,
      height: config.imageGen.height,
    };

    if (negativePrompt) {
      generateImageParams.negativePrompt = negativePrompt;
    }

    const result = await generateImage(generateImageParams);

    if (result?.ok && result?.blob) {
      // Cache the generated image
      await cacheImage(cachePrompt, result.blob, {
        width: result.blob.width,
        height: result.blob.height,
        seed: result.seed,
        negativePrompt,
      });

      // Convert blob to ArrayBuffer for transfer to main thread
      const arrayBuffer = await result.blob.arrayBuffer();
      return { 
        blob: arrayBuffer, 
        type: result.blob.type, 
        cached: false 
      };
    } else {
      throw new Error(result?.message || 'Generation failed');
    }
  } catch (err) {
    console.error('Image generation error:', err);
    throw err;
  }
}

/**
 * Generate prompts for a page using promptEngine
 */
function generatePagePrompts(pageNum, pageOutline) {
  const previousPageContent = pageNum > 0 ? generatedPages[pageNum - 1]?.content : null;
  
  const { textPrompt, imagePrompt } = generatePrompt(
    currentSettings.subject,
    currentSettings,
    pageNum + 1,
    currentNumPages,
    previousPageContent
  );

  return { textPrompt, imagePrompt };
}

/**
 * Generate a single page with text, image, and quip
 */
async function generatePage(pageNum, pageOutline) {
  // Step 1: Get prompts
  const { textPrompt, imagePrompt } = generatePagePrompts(pageNum, pageOutline);

  // Add page-specific context from outline
  const enhancedTextPrompt = `${textPrompt}\n\nFocus on: ${pageOutline.focus}`;

  // Step 2: Generate text and image in parallel
  const [content, imageResult] = await Promise.all([
    generateText(enhancedTextPrompt, { complexity: currentSettings.complexity }),
    generateImageFromPrompt(imagePrompt.positive, { negativePrompt: imagePrompt.negative }),
  ]);

  // Step 3: Generate quip after content is ready
  let quip = null;
  if (content) {
    const quipPrompt = generateQuipPrompt(content, currentSettings.subject);
    quip = await generateQuip(quipPrompt);
  }

  // Store this page's content for semantic consistency with next page
  generatedPages[pageNum] = { content, title: pageOutline.title };

  return {
    title: pageOutline.title,
    content: content || 'Content generation failed.',
    image: imageResult,
    quip: quip,
    settings: { ...currentSettings },
  };
}

/**
 * Process the generation queue
 */
async function processGenerationQueue() {
  if (isGenerating || generationQueue.length === 0) return;

  isGenerating = true;

  while (generationQueue.length > 0) {
    const { pageNum, pageOutline } = generationQueue.shift();

    // Notify main thread that we're starting this page
    rpc.sendEvent('PAGE_START', { pageNum });

    try {
      const pageData = await generatePage(pageNum, pageOutline);

      // Send generated page data back to main thread
      rpc.sendEvent('PAGE_COMPLETE', {
        pageNum,
        pageData,
      });
    } catch (err) {
      console.error(`Worker: Failed to generate page ${pageNum}:`, err);
      rpc.sendEvent('PAGE_ERROR', {
        pageNum,
        error: err.message || 'Generation failed',
      });
    }
  }

  isGenerating = false;
  rpc.sendEvent('QUEUE_COMPLETE', {});
}

// ============ RPC Action Handlers ============

/**
 * Initialize models
 */
rpc.register('INIT_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'image'] } = payload || {};
  const results = {};

  for (const modelType of modelTypes) {
    if (modelType === 'fast' || modelType === 'quality') {
      results[modelType] = await initTextModel(modelType);
    } else if (modelType === 'image') {
      results[modelType] = await initImageModel();
    }
  }

  return results;
});

/**
 * Generate text
 */
rpc.register('GENERATE_TEXT', async (payload) => {
  const { prompt, options = {} } = payload;
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  return await generateText(prompt, options);
});

/**
 * Generate image
 */
rpc.register('GENERATE_IMAGE', async (payload) => {
  const { prompt, options = {} } = payload;
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  return await generateImageFromPrompt(prompt, options);
});

/**
 * Generate quip
 */
rpc.register('GENERATE_QUIP', async (payload) => {
  const { content } = payload;
  if (!content) {
    throw new Error('Content is required');
  }
  return await generateQuip(content);
});

/**
 * Generate outline
 */
rpc.register('GENERATE_OUTLINE', async (payload) => {
  const { subject, settings, numPages } = payload;
  if (!subject || !numPages) {
    throw new Error('Subject and numPages are required');
  }
  
  const outlinePrompt = generateOutlinePrompt(subject, settings, numPages);
  return await generateText(outlinePrompt, { 
    systemPrompt: 'You are an educational content planner. Output ONLY a valid JSON array.' 
  });
});

/**
 * Start book generation
 */
rpc.register('START_GENERATION', async (payload) => {
  const { settings, outline, numPages } = payload;

  // Store context for this generation session
  currentSettings = settings;
  currentNumPages = numPages;

  // Reset state
  generationQueue = [];
  isGenerating = false;
  generatedPages = [];

  // Queue all pages for generation
  generationQueue = outline.map((pageOutline, idx) => ({
    pageNum: idx,
    pageOutline,
  }));

  // Start processing - queue is processed asynchronously and sequentially
  // No need for artificial delays - the async/await pattern handles this naturally
  processGenerationQueue();

  return { queued: generationQueue.length };
});

/**
 * Cancel generation
 */
rpc.register('CANCEL_GENERATION', async () => {
  generationQueue = [];
  isGenerating = false;
  return { cancelled: true };
});

/**
 * Unload models
 */
rpc.register('UNLOAD_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'quality', 'image'] } = payload || {};
  
  for (const modelType of modelTypes) {
    if (modelType === 'fast') {
      modelState.textGenerator = null;
      rpc.sendEvent('MODEL_UNLOADED', { modelType: 'fast' });
    } else if (modelType === 'quality') {
      modelState.qualityTextGenerator = null;
      rpc.sendEvent('MODEL_UNLOADED', { modelType: 'quality' });
    } else if (modelType === 'image') {
      if (modelState.imageModelLoaded) {
        await unloadModel(config.imageGen.modelId);
        modelState.imageModelLoaded = false;
        modelState.imageModelLoadPromise = null;
        rpc.sendEvent('MODEL_UNLOADED', { modelType: 'image' });
      }
    }
  }
  
  return { unloaded: modelTypes };
});

/**
 * Get model status
 */
rpc.register('GET_MODEL_STATUS', async () => {
  return {
    textModel: modelState.textGenerator ? 'ready' : 'not_loaded',
    qualityTextModel: modelState.qualityTextGenerator ? 'ready' : 'not_loaded',
    imageModel: modelState.imageModelLoaded ? 'ready' : 'not_loaded',
    activeTextModel: modelState.activeTextModel,
  };
});

// Initial ready message
rpc.sendEvent('WORKER_READY', {
  timestamp: Date.now(),
  version: '2.0.0',
  features: ['text-generation', 'image-generation', 'rpc-v2'],
});
