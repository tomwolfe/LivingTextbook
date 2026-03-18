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

/**
 * GenerationManager handles the lifecycle of a book generation session
 */
class GenerationManager {
  private queue: Array<{ pageNum: number; pageOutline: OutlineItem }> = [];
  private isGenerating: boolean = false;
  private settings: BookSettings | null = null;
  private numPages: number = 0;
  private generatedPages: Array<{ content: string; title: string } | null> = [];
  private abortController: AbortController | null = null;

  /**
   * Start a new generation session
   */
  async start(settings: BookSettings, outline: OutlineItem[], numPages: number) {
    // Cancel any existing session
    this.cancel();

    this.settings = settings;
    this.numPages = numPages;
    this.generatedPages = Array(numPages).fill(null);
    this.abortController = new AbortController();
    this.queue = outline.map((pageOutline, idx) => ({
      pageNum: idx,
      pageOutline,
    }));

    // Start processing queue asynchronously
    this.processQueue();
    
    return { queued: this.queue.length };
  }

  /**
   * Cancel the current generation session
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.queue = [];
    this.isGenerating = false;
    rpc.sendEvent('GENERATION_CANCELLED', {});
  }

  /**
   * Process the generation queue sequentially
   */
  private async processQueue() {
    if (this.isGenerating || this.queue.length === 0) return;

    this.isGenerating = true;

    while (this.queue.length > 0) {
      // Check for abort BEFORE processing each page
      if (this.abortController?.signal.aborted) {
        this.isGenerating = false;
        return;
      }

      const { pageNum, pageOutline } = this.queue.shift()!;

      // Notify main thread that we're starting this page
      rpc.sendEvent('PAGE_START', { pageNum });

      try {
        const pageData = await this.generatePage(pageNum, pageOutline);

        // Check for abort AFTER generation completes
        if (this.abortController?.signal.aborted) {
          this.isGenerating = false;
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
        if (errorMessage.includes('cancelled') || this.abortController?.signal.aborted) {
          this.isGenerating = false;
          return;
        }

        console.error(`Worker: Failed to generate page ${pageNum}:`, err);
        rpc.sendEvent('PAGE_ERROR', {
          pageNum,
          error: errorMessage,
        });
      }
    }

    this.isGenerating = false;
    rpc.sendEvent('QUEUE_COMPLETE', {});
  }

  /**
   * Generate a single page (sequential text/image)
   */
  private async generatePage(pageNum: number, pageOutline: OutlineItem) {
    const signal = this.abortController?.signal;
    
    if (signal?.aborted) {
      throw new Error('Generation cancelled');
    }

    // Get prompts
    const previousPageContent = pageNum > 0 ? this.generatedPages[pageNum - 1]?.content : null;
    const { textPrompt, imagePrompt } = generatePrompt(
      this.settings!.subject,
      this.settings!,
      pageNum + 1,
      this.numPages,
      previousPageContent
    );

    // Add page-specific context from outline
    const enhancedTextPrompt = `${textPrompt}\n\nFocus on: ${pageOutline.focus}`;

    // Generate text FIRST
    const content = await generateText(enhancedTextPrompt, { 
      complexity: this.settings!.complexity,
      signal // Pass signal to underlying generators
    });

    if (signal?.aborted) throw new Error('Generation cancelled');

    // Generate image SECOND
    const imageResult = await generateImageFromPrompt(imagePrompt.positive, { 
      negativePrompt: imagePrompt.negative,
      signal 
    });

    if (signal?.aborted) throw new Error('Generation cancelled');

    // Generate quip
    let quip: string | null = null;
    if (content) {
      const quipPrompt = generateQuipPrompt(content, this.settings!.subject);
      quip = await generateQuip(quipPrompt, signal);
    }

    // Store content for semantic consistency
    this.generatedPages[pageNum] = { content, title: pageOutline.title };

    return {
      title: pageOutline.title,
      content: content || 'Content generation failed.',
      image: imageResult,
      quip: quip,
      settings: { ...this.settings! },
    };
  }
}

// Global instance of the generation manager
const generationManager = new GenerationManager();

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
  options: TextGenerationOptions & { signal?: AbortSignal } = {}
): Promise<string> {
  const { complexity, maxTokens, temperature, systemPrompt, signal } = options;

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
    if (signal?.aborted) {
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
    // Handles: { generated_text: ... }, [{ generated_text: ... }], or nested arrays
    let content = 'No content generated.';
    
    try {
      const outputArray = Array.isArray(output) ? output : [output];
      const firstOutput = outputArray[0] as Record<string, unknown>;
      const generatedText = firstOutput?.generated_text;

      if (generatedText) {
        // Handle both string and array responses
        if (typeof generatedText === 'string') {
          // Direct string response
          content = generatedText;
        } else if (Array.isArray(generatedText)) {
          // Array of messages - get the last one
          const textArray = generatedText as Array<Record<string, unknown>>;
          if (textArray.length > 0) {
            const lastMessage = textArray[textArray.length - 1] as Record<string, unknown>;
            if (lastMessage?.content && typeof lastMessage.content === 'string') {
              content = lastMessage.content;
            }
          }
        } else if (generatedText && typeof generatedText === 'object' && 'content' in generatedText) {
          // Single message object
          content = (generatedText as Record<string, unknown>).content as string;
        }
      }
    } catch (parseErr) {
      console.warn('Failed to parse generator output, using default message:', parseErr);
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
    
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('cancelled') || signal?.aborted)) {
      throw new Error('Generation cancelled');
    }
    console.error('Text generation error:', err);
    throw err;
  }
}

/**
 * Generate a witty quip
 */
async function generateQuip(content: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const quip = await generateText(content, {
      systemPrompt: 'You are Logic the Lemur, a sassy, playful character who breaks the fourth wall.',
      maxTokens: 50,
      temperature: 0.9,
      signal,
    });
    return quip;
  } catch (err) {
    if (signal?.aborted) throw err;
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
  options: ImageGenerationOptions & { signal?: AbortSignal } = {}
): Promise<{ buffer: ArrayBuffer; type: string; cached: boolean }> {
  const { negativePrompt, signal } = options;

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
    if (signal?.aborted) {
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
    if (signal?.aborted) {
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
    if (err instanceof Error && (err.message.includes('cancelled') || signal?.aborted)) {
      throw new Error('Generation cancelled');
    }
    console.error('Image generation error:', err);
    throw err;
  }
}

// ============ RPC Action Handlers ============

/**
 * Initialize models
 */
rpc.register('INIT_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'image'] } = payload || {};
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
  const result = await generateImageFromPrompt(prompt, options);

  // Return the result with buffer for transfer
  return result;
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
  return await generationManager.start(settings, outline, numPages);
});

/**
 * Cancel generation
 */
rpc.register('CANCEL_GENERATION', async () => {
  generationManager.cancel();
  return { cancelled: true };
});

/**
 * Unload models
 */
rpc.register('UNLOAD_MODELS', async (payload) => {
  const { modelTypes = ['fast', 'quality', 'image'] } = payload || {};

  for (const modelType of modelTypes) {
    if (modelType === 'fast') {
      // Explicitly dispose WebGPU/text generator to prevent VRAM leaks
      const generator = modelState.textGenerator;
      if (generator && typeof (generator as Record<string, unknown>).dispose === 'function') {
        try {
          await ((generator as Record<string, unknown>).dispose as () => Promise<void>)();
        } catch (disposeErr) {
          console.warn('Text generator dispose error:', disposeErr);
        }
      }
      modelState.textGenerator = null;
      rpc.sendEvent('MODEL_UNLOADED', { modelType: 'fast' });
    } else if (modelType === 'quality') {
      // Explicitly dispose WebGPU/text generator to prevent VRAM leaks
      const generator = modelState.qualityTextGenerator;
      if (generator && typeof (generator as Record<string, unknown>).dispose === 'function') {
        try {
          await ((generator as Record<string, unknown>).dispose as () => Promise<void>)();
        } catch (disposeErr) {
          console.warn('Quality text generator dispose error:', disposeErr);
        }
      }
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
