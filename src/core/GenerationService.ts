/**
 * Generation Service
 * Handles text and image generation operations
 */

import type {
  TextGenerationOptions,
  ImageGenerationOptions,
  ImageResult,
  BookSettings,
  OutlineItem,
} from '../types';
import { WorkerService } from './WorkerService';
import { generationLogger } from '../utils/logger';
import { withRetry, toAppError, DEFAULT_RETRY_CONFIG, isCancellation } from '../utils/errors';
import { getCachedImage } from '../utils/imageCache';
import { config } from '../config';

export interface GenerationServiceConfig {
  workerService: WorkerService;
}

/**
 * GenerationService handles all generation operations
 */
export class GenerationService {
  private workerService: WorkerService;
  private blobUrls: Set<string> = new Set();

  constructor(config: GenerationServiceConfig) {
    this.workerService = config.workerService;
  }

  /**
   * Generate text from a prompt
   */
  async generateText(
    prompt: string,
    options: TextGenerationOptions = {}
  ): Promise<string | null> {
    const { complexity, skipStatus, ...generationOptions } = options;
    const isQuality = complexity !== undefined && complexity >= config.textGen.complexityThreshold;

    const performGeneration = async (): Promise<string> => {
      try {
        const result = await this.workerService.send('GENERATE_TEXT', {
          prompt,
          options: {
            complexity,
            ...generationOptions,
          },
        });
        return result as string;
      } catch (error) {
        generationLogger.error('Text generation failed', error as Error);
        throw error;
      }
    };

    try {
      const result = await withRetry(
        performGeneration,
        { ...DEFAULT_RETRY_CONFIG, maxRetries: 1 },
        (attempt, error, delayMs) => {
          if (!isCancellation(error)) {
            generationLogger.warn(`Text generation retry ${attempt}/1`, { error });
          }
        }
      );

      return result;
    } catch (error) {
      const appError = toAppError(error as Error, 'Text generation');
      generationLogger.error('Text generation failed after retries', { error: appError });
      return null;
    }
  }

  /**
   * Generate a witty quip
   */
  async generateQuip(content: string): Promise<string | null> {
    try {
      const quip = await this.generateText(content, {
        systemPrompt: 'You are Logic the Lemur, a sassy, playful character who breaks the fourth wall.',
        maxTokens: 50,
        temperature: 0.9,
        skipStatus: true,
      });
      return quip;
    } catch (error) {
      generationLogger.warn('Failed to generate quip', { error: error as Error });
      return null;
    }
  }

  /**
   * Generate image from a prompt
   */
  async generateImage(
    prompt: string,
    options: ImageGenerationOptions = {}
  ): Promise<ImageResult | null> {
    const { skipCache = false, useCache = true, negativePrompt } = options;

    // Check cache first
    const cachePrompt = negativePrompt ? `${prompt}|${negativePrompt}` : prompt;
    if (useCache && !skipCache) {
      try {
        const cachedBlob = await getCachedImage(cachePrompt);
        if (cachedBlob) {
          generationLogger.debug('Image cache hit', { prompt: prompt.substring(0, 50) });
          const imageUrl = URL.createObjectURL(cachedBlob);
          this.blobUrls.add(imageUrl);
          return { imageUrl, blob: cachedBlob, cached: true };
        }
      } catch (error) {
        generationLogger.warn('Cache lookup failed', { error: error as Error });
      }
    }

    const performGeneration = async (): Promise<ImageResult> => {
      try {
        const result = await this.workerService.send('GENERATE_IMAGE', {
          prompt,
          options: { negativePrompt, useCache: false },
        });

        const resultTyped = result as { buffer?: ArrayBuffer; type?: string; cached?: boolean } | null;
        if (resultTyped?.buffer) {
          const blob = new Blob([resultTyped.buffer], { type: resultTyped.type || 'image/png' });
          const imageUrl = URL.createObjectURL(blob);
          this.blobUrls.add(imageUrl);
          return { imageUrl, blob, cached: resultTyped.cached || false };
        } else {
          throw new Error('Image generation failed');
        }
      } catch (error) {
        generationLogger.error('Image generation failed', error as Error);
        throw error;
      }
    };

    try {
      const result = await withRetry(
        performGeneration,
        { ...DEFAULT_RETRY_CONFIG, maxRetries: 1 },
        (attempt, error, delayMs) => {
          if (!isCancellation(error)) {
            generationLogger.warn(`Image generation retry ${attempt}/1`, { error });
          }
        }
      );

      return result;
    } catch (error) {
      const appError = toAppError(error as Error, 'Image generation');
      generationLogger.error('Image generation failed after retries', { error: appError });
      return null;
    }
  }

  /**
   * Generate outline for a book
   */
  async generateOutline(
    subject: string,
    settings: BookSettings,
    numPages: number
  ): Promise<string> {
    if (!this.workerService.isReady()) {
      throw new Error('Worker not initialized');
    }

    try {
      const result = await this.workerService.send('GENERATE_OUTLINE', {
        subject,
        settings,
        numPages,
      });
      return result as string;
    } catch (error) {
      generationLogger.error('Outline generation failed', error as Error);
      throw error;
    }
  }

  /**
   * Start book generation
   */
  async startBookGeneration(
    settings: BookSettings,
    outline: OutlineItem[],
    numPages: number
  ): Promise<void> {
    if (!this.workerService.isReady()) {
      throw new Error('Worker not initialized');
    }

    // Clear existing blob URLs before starting new generation
    this.clearBlobUrls();

    try {
      await this.workerService.send('START_GENERATION', {
        settings,
        outline,
        numPages,
      });
    } catch (error) {
      generationLogger.error('Failed to start book generation', error as Error);
      throw error;
    }
  }

  /**
   * Cancel book generation
   */
  async cancelBookGeneration(): Promise<void> {
    if (!this.workerService.isReady()) return;

    try {
      await this.workerService.send('CANCEL_GENERATION', {});
    } catch (error) {
      generationLogger.error('Failed to cancel book generation', error as Error);
      throw error;
    }
  }

  /**
   * Revoke a specific blob URL
   */
  revokeBlobUrl(url: string): void {
    try {
      URL.revokeObjectURL(url);
      this.blobUrls.delete(url);
    } catch (error) {
      generationLogger.warn('Failed to revoke blob URL', { error: error as Error });
    }
  }

  /**
   * Clear all tracked blob URLs
   */
  clearBlobUrls(): void {
    for (const url of this.blobUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        generationLogger.warn('Failed to revoke blob URL', { error: error as Error });
      }
    }
    this.blobUrls.clear();
  }

  /**
   * Get count of tracked blob URLs
   */
  getBlobUrlCount(): number {
    return this.blobUrls.size;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.clearBlobUrls();
  }
}

export default GenerationService;
