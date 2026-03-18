/**
 * GenerationWorker - Handles ALL AI model operations off the main thread
 *
 * This worker contains the complete AI inference logic:
 * - Text generation (SmolLM2, Qwen2.5)
 * - Image generation (SD-Turbo)
 * - Model lifecycle management
 * - Book generation orchestration
 *
 * Communication uses UUID-based RPC to prevent race conditions.
 */

import { pipeline, env, AutoTokenizer } from '@huggingface/transformers';
import { loadModel, generateImage, unloadModel, detectCapabilities } from 'web-txt2img';
import type { LoadResult, GenerateResult } from 'web-txt2img';
import { config } from '../config';
import { generatePrompt, generateOutlinePrompt, generateQuipPrompt } from '../utils/promptEngine';
import { WorkerRPC } from '../utils/workerRPC';
import { cacheImage } from '../utils/imageCache';
import type {
  WorkerActionPayloads,
  TextGenerationOptions,
  ImageGenerationOptions,
  BookSettings,
  OutlineItem,
  ModelType,
} from '../types';

// Configure transformers.js environment
env.allowLocalModels = config.transformers.allowLocalModels;
env.useBrowserCache = config.transformers.useBrowserCache;

// Initialize RPC handler
const rpc = new WorkerRPC();

// Model state - use unknown for pipeline to avoid type compatibility issues with transformers.js v3
interface ModelState {
  textGenerator: unknown | null;
  qualityTextGenerator: unknown | null;
  imageModelLoaded: boolean;
  imageModelLoadPromise: Promise<LoadResult | null> | null;
  activeTextModel: 'fast' | 'quality';
}

const modelState: ModelState = {
  textGenerator: null,
  qualityTextGenerator: null,
  imageModelLoaded: false,
  imageModelLoadPromise: null,
  activeTextModel: 'fast',
};

// Generation session state
interface GenerationSessionState {
  queue: Array<{ pageNum: number; pageOutline: OutlineItem }>;
  isGenerating: boolean;
  settings: BookSettings | null;
  numPages: number;
  generatedPages: Array<{ content: string; title: string } | null>;
}

const generationSession: GenerationSessionState = {
  queue: [],
  isGenerating: false,
  settings: null,
  numPages: 0,
  generatedPages: [],
};

// AbortController for cancellation
let abortController: AbortController | null = null;

/**
 * Initialize text generation model (fast or quality)
 */
async function initTextModel(modelType: 'fast' | 'quality' = 'fast'): Promise<{ success: boolean; device?: string; modelName?: string; error?: string }> {
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
    const progressCallback = (data: { status?: string; progress?: number | string }) => {
      if (data?.status === 'progress') {
        const progressVal = typeof data.progress === 'number' ? data.progress : parseFloat(String(data.progress || 0));
        rpc.sendEvent('MODEL_PROGRESS', {
          modelType: isQuality ? 'quality' : 'fast',
          progress: parseFloat(progressVal.toFixed(2)),
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
      error: err instanceof Error ? err.message : 'Failed to load text model',
    });
    return { success: false, error: err instanceof Error ? err.message : 'Failed to load text model' };
  }
}

/**
 * Initialize image generation model
 */
async function initImageModel(): Promise<{ success: boolean; error?: string }> {
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
      return async (text: string) => {
        const tokens = await tokenizer.encode(text);

        let tokenIds: number[] | { input_ids?: number[] | Iterable<number> };
        if (typeof tokens === 'object' && tokens !== null && 'input_ids' in tokens) {
          tokenIds = tokens.input_ids || [];
        } else {
          tokenIds = tokens as number[];
        }

        let tokenIdsArray: number[];
        if (Array.isArray(tokenIds)) {
          tokenIdsArray = tokenIds;
        } else if (typeof tokenIds === 'object' && tokenIds !== null && 'tolist' in tokenIds && typeof tokenIds.tolist === 'function') {
          tokenIdsArray = tokenIds.tolist();
        } else if (typeof tokenIds === 'object' && tokenIds !== null && Symbol.iterator in tokenIds) {
          tokenIdsArray = [...tokenIds as Iterable<number>];
        } else {
          tokenIdsArray = [tokenIds as number];
        }

        while (tokenIdsArray.length < 77) {
          tokenIdsArray.push(0);
        }

        if (tokenIdsArray.length > 77) {
          tokenIdsArray = tokenIdsArray.slice(0, 77);
        }

        return { input_ids: tokenIdsArray };
      };
    };

    // Load model
    modelState.imageModelLoadPromise = loadModel(
      config.imageGen.modelId as 'sd-turbo',
      {
        backendPreference: ['webgpu'],
        tokenizerProvider,
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
      error: err instanceof Error ? err.message : 'Failed to load image model',
    });
    return { success: false, error: err instanceof Error ? err.message : 'Failed to load image model' };
  }
}

/**
 * Generate text from a prompt
 */
let webgpuFailed = false; // Track if WebGPU execution has failed

async function generateText(
  prompt: string,
  options: TextGenerationOptions = {}
): Promise<string> {
  const { complexity, maxTokens, temperature, systemPrompt } = options;

  // Determine which model to use based on complexity
  const modelType = complexity !== undefined && complexity >= config.textGen.complexityThreshold ? 'quality' : 'fast';

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

    // Check for abort signal
    if (abortController?.signal.aborted) {
      throw new Error('Generation cancelled');
    }

    // Call generator directly - casting only for TypeScript
    const output = await (generator as (
      messages: Array<{ role: string; content: string }>,
      config: Record<string, unknown>
    ) => Promise<unknown>)(messages, {
      max_new_tokens: maxTokens || config.textGen.maxNewTokens,
      temperature: temperature || config.textGen.temperature,
      do_sample: options.doSample ?? config.textGen.doSample,
    });

    // Extract content from chat format
    // Output can be array or single object depending on transformers.js version
    const outputArray = Array.isArray(output) ? output : [output];
    const firstOutput = outputArray[0] as Record<string, unknown>;
    const generatedText = firstOutput?.generated_text;
    
    let content = 'No content generated.';
    if (generatedText) {
      const textArray = Array.isArray(generatedText) ? generatedText : [generatedText];
      const lastMessage = textArray[textArray.length - 1] as Record<string, unknown>;
      if (lastMessage?.content) {
        content = lastMessage.content as string;
      }
    }

    return content;
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    const errorCode = (err as Error).name;
    
    // Check if this is a WebGPU error (numeric error codes or device lost)
    const isWebGPUError = typeof err === 'number' || 
                          errorCode === 'GPUCanvasError' || 
                          errorCode === 'GPUDeviceLostInfo' ||
                          errorMsg.includes('device') ||
                          errorMsg.includes('WebGPU');
    
    // If WebGPU failed and we haven't tried CPU yet, retry with CPU model
    if (isWebGPUError && !webgpuFailed) {
      console.warn('WebGPU execution failed, falling back to CPU:', err);
      webgpuFailed = true;
      
      // Unload current model and reload CPU version
      const cpuModelId = modelType === 'quality' ? config.textGen.qualityModelIdCPU : config.textGen.fastModelIdCPU;
      const modelName = modelType === 'quality' ? 'Qwen2.5-0.5B (CPU)' : 'SmolLM2-135M (CPU)';
      
      rpc.sendEvent('MODEL_PROGRESS', {
        modelType: modelType === 'quality' ? 'quality' : 'fast',
        progress: 0,
        status: `WebGPU failed, loading ${modelName} for CPU...`,
      });
      
      // Reload model on CPU
      const cpuGenerator = await pipeline(
        'text-generation',
        cpuModelId,
        {
          progress_callback: (data: { status?: string; progress?: number | string }) => {
            if (data?.status === 'progress') {
              const progressVal = typeof data.progress === 'number' ? data.progress : parseFloat(String(data.progress || 0));
              rpc.sendEvent('MODEL_PROGRESS', {
                modelType: modelType === 'quality' ? 'quality' : 'fast',
                progress: parseFloat(progressVal.toFixed(2)),
                status: `Loading ${modelName}...`,
              });
            }
          },
        }
      );
      
      if (modelType === 'quality') {
        modelState.qualityTextGenerator = cpuGenerator;
      } else {
        modelState.textGenerator = cpuGenerator;
      }
      
      rpc.sendEvent('MODEL_LOADED', {
        modelType: modelType === 'quality' ? 'quality' : 'fast',
        device: 'CPU',
        modelName,
      });
      
      // Retry generation with CPU model
      return generateText(prompt, options);
    }
    
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('cancelled'))) {
      throw new Error('Generation cancelled');
    }
    console.error('Text generation error:', err);
    throw err;
  }
}

/**
 * Generate a witty quip
 */
async function generateQuip(content: string): Promise<string | null> {
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
 * Note: Cache is checked by main thread before calling this function
 */
async function generateImageFromPrompt(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<{ buffer: ArrayBuffer; type: string; cached: boolean }> {
  const { negativePrompt } = options;

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
    // Check for abort before starting generation
    if (abortController?.signal.aborted) {
      throw new Error('Generation cancelled');
    }

    rpc.sendEvent('GENERATION_PROGRESS', {
      stage: 'image',
      status: 'Generating image...',
    });

    const generateImageParams = {
      model: config.imageGen.modelId as 'sd-turbo',
      prompt,
      seed: Math.floor(Math.random() * (config.imageGen.seedRange.max - config.imageGen.seedRange.min) + config.imageGen.seedRange.min),
      width: config.imageGen.width,
      height: config.imageGen.height,
      negativePrompt: negativePrompt,
    };

    const result = await generateImage(generateImageParams) as GenerateResult;

    // Check for abort after generation completes
    if (abortController?.signal.aborted) {
      throw new Error('Generation cancelled');
    }

    if (result?.ok && result?.blob) {
      // Cache the generated image for future use
      const cachePrompt = negativePrompt ? `${prompt}|${negativePrompt}` : prompt;
      await cacheImage(cachePrompt, result.blob, {
        width: config.imageGen.width,
        height: config.imageGen.height,
        seed: generateImageParams.seed,
        negativePrompt,
      });

      // For RPC responses: return ArrayBuffer for zero-copy transfer
      // The main thread will reconstruct the blob and create object URL
      const arrayBuffer = await result.blob.arrayBuffer();

      return {
        buffer: arrayBuffer,
        type: result.blob.type || 'image/png',
        cached: false
      };
    } else {
      throw new Error('Generation failed');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('cancelled')) {
      throw new Error('Generation cancelled');
    }
    console.error('Image generation error:', err);
    throw err;
  }
}

/**
 * Generate prompts for a page using promptEngine
 */
function generatePagePrompts(pageNum: number, pageOutline: OutlineItem): { textPrompt: string; imagePrompt: { positive: string; negative: string } } {
  const previousPageContent = pageNum > 0 ? generationSession.generatedPages[pageNum - 1]?.content : null;

  const { textPrompt, imagePrompt } = generatePrompt(
    generationSession.settings!.subject,
    generationSession.settings!,
    pageNum + 1,
    generationSession.numPages,
    previousPageContent
  );

  return { textPrompt, imagePrompt };
}

/**
 * Generate a single page with text, image, and quip
 * Note: Text and image generation are executed SEQUENTIALLY to prevent VRAM exhaustion.
 * Running two WebGPU models simultaneously crashes most consumer devices.
 */
async function generatePage(pageNum: number, pageOutline: OutlineItem): Promise<{
  title: string;
  content: string;
  image: { buffer: ArrayBuffer; type: string; cached: boolean };
  quip: string | null;
  settings: BookSettings;
}> {
  // Check for abort before starting page generation
  if (abortController?.signal.aborted) {
    throw new Error('Generation cancelled');
  }

  // Step 1: Get prompts
  const { textPrompt, imagePrompt } = generatePagePrompts(pageNum, pageOutline);

  // Add page-specific context from outline
  const enhancedTextPrompt = `${textPrompt}\n\nFocus on: ${pageOutline.focus}`;

  // Step 2: Generate text FIRST (sequential to avoid VRAM spike)
  const content = await generateText(enhancedTextPrompt, { complexity: generationSession.settings!.complexity });

  // Check for abort after text generation
  if (abortController?.signal.aborted) {
    throw new Error('Generation cancelled');
  }

  // Step 3: Generate image SECOND (after text model releases VRAM)
  const imageResult = await generateImageFromPrompt(imagePrompt.positive, { negativePrompt: imagePrompt.negative });

  // Check for abort after image generation
  if (abortController?.signal.aborted) {
    throw new Error('Generation cancelled');
  }

  // Step 4: Generate quip after content is ready
  let quip: string | null = null;
  if (content) {
    const quipPrompt = generateQuipPrompt(content, generationSession.settings!.subject);
    quip = await generateQuip(quipPrompt);
  }

  // Store this page's content for semantic consistency with next page
  generationSession.generatedPages[pageNum] = { content, title: pageOutline.title };

  return {
    title: pageOutline.title,
    content: content || 'Content generation failed.',
    image: imageResult,
    quip: quip,
    settings: { ...generationSession.settings! },
  };
}

/**
 * Process the generation queue
 */
async function processGenerationQueue(): Promise<void> {
  if (generationSession.isGenerating || generationSession.queue.length === 0) return;

  generationSession.isGenerating = true;

  while (generationSession.queue.length > 0) {
    // Check for abort BEFORE processing each page
    if (abortController?.signal.aborted) {
      generationSession.queue = [];
      generationSession.isGenerating = false;
      rpc.sendEvent('GENERATION_CANCELLED', {});
      return;
    }

    const { pageNum, pageOutline } = generationSession.queue.shift()!;

    // Notify main thread that we're starting this page
    rpc.sendEvent('PAGE_START', { pageNum });

    try {
      // Double-check abort before starting generation
      if (abortController?.signal.aborted) {
        generationSession.queue = [];
        generationSession.isGenerating = false;
        rpc.sendEvent('GENERATION_CANCELLED', {});
        return;
      }

      const pageData = await generatePage(pageNum, pageOutline);

      // Check for abort AFTER generation completes (before sending result)
      if (abortController?.signal.aborted) {
        generationSession.queue = [];
        generationSession.isGenerating = false;
        rpc.sendEvent('GENERATION_CANCELLED', {});
        return;
      }

      // Send generated page data back to main thread
      rpc.sendEvent('PAGE_COMPLETE', {
        pageNum,
        pageData,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';

      // Check if this was a cancellation
      if (errorMessage.includes('cancelled')) {
        generationSession.queue = [];
        generationSession.isGenerating = false;
        rpc.sendEvent('GENERATION_CANCELLED', {});
        return;
      }

      console.error(`Worker: Failed to generate page ${pageNum}:`, err);
      rpc.sendEvent('PAGE_ERROR', {
        pageNum,
        error: errorMessage,
      });
    }
  }

  generationSession.isGenerating = false;
  rpc.sendEvent('QUEUE_COMPLETE', {});
}

// ============ RPC Action Handlers ============

/**
 * Initialize models
 */
rpc.register('INIT_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'image'] } = (payload as WorkerActionPayloads['INIT_MODELS']) || {};
  const results: Record<string, { success?: boolean }> = {};

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
  const { prompt, options = {} } = payload as WorkerActionPayloads['GENERATE_TEXT'];
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  return await generateText(prompt, options);
});

/**
 * Generate image
 */
rpc.register('GENERATE_IMAGE', async (payload) => {
  const { prompt, options = {} } = payload as WorkerActionPayloads['GENERATE_IMAGE'];
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  const result = await generateImageFromPrompt(prompt, options);

  // Return the result with buffer for transfer
  return result;
});

/**
 * Generate quip
 */
rpc.register('GENERATE_QUIP', async (payload) => {
  const { content } = payload as WorkerActionPayloads['GENERATE_QUIP'];
  if (!content) {
    throw new Error('Content is required');
  }
  return await generateQuip(content);
});

/**
 * Generate outline
 */
rpc.register('GENERATE_OUTLINE', async (payload) => {
  const { subject, settings, numPages } = payload as WorkerActionPayloads['GENERATE_OUTLINE'];
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
  const { settings, outline, numPages } = payload as WorkerActionPayloads['START_GENERATION'];

  // Store context for this generation session
  generationSession.settings = settings;
  generationSession.numPages = numPages;

  // Reset state and create new AbortController for this generation session
  generationSession.queue = [];
  generationSession.isGenerating = false;
  generationSession.generatedPages = [];
  abortController = new AbortController();

  // Queue all pages for generation
  generationSession.queue = outline.map((pageOutline, idx) => ({
    pageNum: idx,
    pageOutline,
  }));

  // Start processing - queue is processed asynchronously and sequentially
  // No need for artificial delays - the async/await pattern handles this naturally
  processGenerationQueue();

  return { queued: generationSession.queue.length };
});

/**
 * Cancel generation
 */
rpc.register('CANCEL_GENERATION', async () => {
  // Abort the current generation
  if (abortController) {
    abortController.abort();
    // Create a new AbortController for future generations
    abortController = new AbortController();
  }

  // Synchronously clear the queue to prevent race conditions
  generationSession.queue = [];
  generationSession.isGenerating = false;

  // Notify main thread that generation was cancelled
  rpc.sendEvent('GENERATION_CANCELLED', {});

  return { cancelled: true };
});

/**
 * Unload models
 */
rpc.register('UNLOAD_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'quality', 'image'] } = (payload as WorkerActionPayloads['UNLOAD_MODELS']) || {};

  for (const modelType of modelTypes) {
    if (modelType === 'fast') {
      modelState.textGenerator = null;
      rpc.sendEvent('MODEL_UNLOADED', { modelType: 'fast' });
    } else if (modelType === 'quality') {
      modelState.qualityTextGenerator = null;
      rpc.sendEvent('MODEL_UNLOADED', { modelType: 'quality' });
    } else if (modelType === 'image') {
      if (modelState.imageModelLoaded) {
        await unloadModel(config.imageGen.modelId as 'sd-turbo');
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
