/**
 * Model Lifecycle Service
 * Manages AI model initialization, loading, and unloading
 */

import type {
  ModelState,
  ModelStatusType,
  ModelType,
  WebGPUCapabilities,
  DeviceResources,
} from '../types';
import { WorkerService } from './WorkerService';
import { modelLogger } from '../utils/logger';
import { withRetry, toAppError, DEFAULT_RETRY_CONFIG, isCancellation } from '../utils/errors';

export interface ModelLifecycleConfig {
  workerService: WorkerService;
}

export interface ModelLoadResult {
  success: boolean;
  device?: string;
  modelName?: string;
  error?: string;
}

/**
 * Create initial model state
 */
export function createInitialModelState(): ModelState {
  return {
    status: 'Idle',
    loading: false,
    progress: 0,
    error: null,
    device: null,
    modelName: null,
  };
}

/**
 * ModelLifecycleService handles model initialization and cleanup
 */
export class ModelLifecycleService {
  private workerService: WorkerService;
  private textModelState: ModelState = createInitialModelState();
  private qualityTextModelState: ModelState = createInitialModelState();
  private imageModelState: ModelState = createInitialModelState();
  private activeTextModel: 'fast' | 'quality' = 'fast';
  private stateSubscribers: Set<(states: ModelStates) => void> = new Set();
  private snapshot: ModelStates | null = null;

  constructor(config: ModelLifecycleConfig) {
    this.workerService = config.workerService;
    this.snapshot = this.getStates();
  }

  /**
   * Get current model states
   */
  getStates(): ModelStates {
    return {
      textModel: { ...this.textModelState },
      qualityTextModel: { ...this.qualityTextModelState },
      imageModel: { ...this.imageModelState },
      activeTextModel: this.activeTextModel,
    };
  }

  /**
   * Get snapshot for useSyncExternalStore - returns stable reference
   */
  getSnapshot(): ModelStates {
    return this.snapshot!;
  }

  /**
   * Subscribe to state changes
   */
  subscribeState(callback: (states: ModelStates) => void): () => void {
    this.stateSubscribers.add(callback);
    return () => this.stateSubscribers.delete(callback);
  }

  /**
   * Notify state subscribers
   */
  private notifyStateChange(): void {
    // Update snapshot with new state
    this.snapshot = this.getStates();
    
    const states = this.snapshot;
    for (const callback of this.stateSubscribers) {
      try {
        callback(states);
      } catch (error) {
        modelLogger.error('State subscriber error', error as Error);
      }
    }
  }

  /**
   * Initialize text model with retry
   */
  async initTextModel(modelType: 'fast' | 'quality' = 'fast'): Promise<ModelLoadResult> {
    const isQuality = modelType === 'quality';
    const setState = isQuality
      ? (state: ModelState) => { this.qualityTextModelState = state; }
      : (state: ModelState) => { this.textModelState = state; };

    const performInit = async (): Promise<ModelLoadResult> => {
      try {
        const result = await this.workerService.send('INIT_MODELS', {
          modelTypes: [modelType],
        });

        const success = (result as Record<string, { success?: boolean }>)?.[modelType]?.success || false;
        return { success };
      } catch (error) {
        modelLogger.error('Text model initialization failed', error as Error);
        throw error;
      }
    };

    // Set loading state
    setState({
      ...createInitialModelState(),
      status: 'Loading',
      loading: true,
    });
    this.notifyStateChange();

    try {
      const result = await withRetry(
        performInit,
        DEFAULT_RETRY_CONFIG,
        (attempt, error, delayMs) => {
          modelLogger.warn(`Text model init retry ${attempt}/${DEFAULT_RETRY_CONFIG.maxRetries}`, { error });
        }
      );

      // Update state on success
      setState({
        status: 'Ready',
        loading: false,
        progress: 100,
        error: null,
        device: 'WebGPU',
        modelName: isQuality ? 'Qwen2.5-0.5B' : 'SmolLM2-135M',
      });

      if (result.success) {
        this.activeTextModel = modelType;
      }

      this.notifyStateChange();
      return result;
    } catch (error) {
      const appError = toAppError(error, 'Text model initialization');
      
      // Ensure any partially loaded model is unloaded to free VRAM
      try {
        await this.workerService.send('UNLOAD_MODELS', {
          modelTypes: [modelType],
        });
      } catch (unloadError) {
        modelLogger.warn('Failed to unload partially loaded model', { error: unloadError as Error });
      }
      
      setState({
        status: 'Error',
        loading: false,
        error: appError.message,
        progress: 0,
        device: null,
        modelName: null,
      });
      this.notifyStateChange();
      return { success: false, error: appError.message };
    }
  }

  /**
   * Initialize image model with retry
   */
  async initImageModel(): Promise<ModelLoadResult> {
    const performInit = async (): Promise<ModelLoadResult> => {
      try {
        const result = await this.workerService.send('INIT_MODELS', {
          modelTypes: ['image'],
        });
        return { success: (result as Record<string, { success?: boolean }>)?.image?.success || false };
      } catch (error) {
        modelLogger.error('Image model initialization failed', error as Error);
        throw error;
      }
    };

    // Set loading state
    this.imageModelState = {
      ...createInitialModelState(),
      status: 'Loading',
      loading: true,
    };
    this.notifyStateChange();

    try {
      const result = await withRetry(
        performInit,
        DEFAULT_RETRY_CONFIG,
        (attempt, error, delayMs) => {
          modelLogger.warn(`Image model init retry ${attempt}/${DEFAULT_RETRY_CONFIG.maxRetries}`, { error });
        }
      );

      if (result.success) {
        this.imageModelState = {
          status: 'Ready',
          loading: false,
          progress: 100,
          error: null,
          device: 'WebGPU',
          modelName: 'SD-Turbo',
        };
      } else {
        this.imageModelState = createInitialModelState();
      }

      this.notifyStateChange();
      return result;
    } catch (error) {
      const appError = toAppError(error, 'Image model initialization');
      
      // Ensure any partially loaded model is unloaded to free VRAM
      try {
        await this.workerService.send('UNLOAD_MODELS', {
          modelTypes: ['image'],
        });
      } catch (unloadError) {
        modelLogger.warn('Failed to unload partially loaded image model', { error: unloadError as Error });
      }
      
      this.imageModelState = {
        status: 'Error',
        loading: false,
        error: appError.message,
        progress: 0,
        device: null,
        modelName: null,
      };
      this.notifyStateChange();
      return { success: false, error: appError.message };
    }
  }

  /**
   * Unload text models
   */
  async unloadTextModel(): Promise<void> {
    if (!this.workerService.isReady()) return;

    try {
      await this.workerService.send('UNLOAD_MODELS', {
        modelTypes: ['fast', 'quality'],
      });

      this.textModelState = createInitialModelState();
      this.qualityTextModelState = createInitialModelState();
      this.activeTextModel = 'fast';
      this.notifyStateChange();
    } catch (error) {
      modelLogger.error('Failed to unload text models', error as Error);
    }
  }

  /**
   * Unload image model
   */
  async unloadImageModel(): Promise<void> {
    if (!this.workerService.isReady()) return;

    try {
      await this.workerService.send('UNLOAD_MODELS', {
        modelTypes: ['image'],
      });

      this.imageModelState = createInitialModelState();
      this.notifyStateChange();
    } catch (error) {
      modelLogger.error('Failed to unload image model', error as Error);
    }
  }

  /**
   * Unload all models
   */
  async unloadAllModels(): Promise<void> {
    if (!this.workerService.isReady()) return;

    try {
      await this.workerService.send('UNLOAD_MODELS', {
        modelTypes: ['fast', 'quality', 'image'],
      });

      this.textModelState = createInitialModelState();
      this.qualityTextModelState = createInitialModelState();
      this.imageModelState = createInitialModelState();
      this.activeTextModel = 'fast';
      this.notifyStateChange();
    } catch (error) {
      modelLogger.error('Failed to unload all models', error as Error);
    }
  }

  /**
   * Get model status from worker
   */
  async getModelStatus(): Promise<Record<string, string> | null> {
    if (!this.workerService.isReady()) return null;

    try {
      return await this.workerService.send('GET_MODEL_STATUS', {}) as Record<string, string>;
    } catch (error) {
      modelLogger.error('Failed to get model status', error as Error);
      return null;
    }
  }

  /**
   * Handle model progress events
   */
  handleModelProgress(modelType: string, progress: number, status?: ModelStatusType): void {
    const setState = (state: Partial<ModelState>) => {
      if (modelType === 'quality') {
        this.qualityTextModelState = { ...this.qualityTextModelState, ...state };
      } else if (modelType === 'fast' || modelType === 'text') {
        this.textModelState = { ...this.textModelState, ...state };
      } else if (modelType === 'image') {
        this.imageModelState = { ...this.imageModelState, ...state };
      }
    };

    setState({
      progress,
      status,
      loading: progress < 100,
    });
    this.notifyStateChange();
  }

  /**
   * Handle model loaded events
   */
  handleModelLoaded(modelType: string, device: string, modelName?: string): void {
    const setState = (state: ModelState) => {
      if (modelType === 'quality') {
        this.qualityTextModelState = state;
      } else if (modelType === 'fast') {
        this.textModelState = state;
        this.activeTextModel = 'fast';
      } else if (modelType === 'image') {
        this.imageModelState = state;
      }
    };

    setState({
      status: 'Ready',
      loading: false,
      progress: 100,
      device,
      modelName: modelName || undefined,
      error: null,
    });
    this.notifyStateChange();
  }

  /**
   * Handle model error events
   */
  handleModelError(modelType: string, error: string): void {
    const setState = (state: ModelState) => {
      if (modelType === 'quality' || modelType === 'fast') {
        this.qualityTextModelState = state;
      } else if (modelType === 'image') {
        this.imageModelState = state;
      }
    };

    setState({
      status: 'Error',
      loading: false,
      error,
      progress: 0,
      device: null,
      modelName: null,
    });
    this.notifyStateChange();
  }

  /**
   * Handle model unloaded events
   */
  handleModelUnloaded(modelType: string): void {
    if (modelType === 'fast' || modelType === 'quality') {
      this.textModelState = createInitialModelState();
      this.qualityTextModelState = createInitialModelState();
      this.activeTextModel = 'fast';
    } else if (modelType === 'image') {
      this.imageModelState = createInitialModelState();
    }
    this.notifyStateChange();
  }
}

export interface ModelStates {
  textModel: ModelState;
  qualityTextModel: ModelState;
  imageModel: ModelState;
  activeTextModel: 'fast' | 'quality';
}

export default ModelLifecycleService;
