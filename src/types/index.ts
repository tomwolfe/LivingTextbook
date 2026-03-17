/**
 * Core TypeScript types and interfaces for Living Textbook
 */

// ============ Book Data Types ============

/**
 * Represents a single page in the book
 */
export interface Page {
  title: string;
  content: string;
  image?: ImageResult;
  imagePrompt?: string;
  quip?: string | null;
  settings?: BookSettings;
}

/**
 * Represents a complete book
 */
export interface Book {
  id?: string;
  subject: string;
  pages: (Page | null)[];
  settings: BookSettings;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Book outline item for planning
 */
export interface OutlineItem {
  title: string;
  focus: string;
}

/**
 * User-configurable book settings
 */
export interface BookSettings {
  subject: string;
  tone: number; // 0-1
  style: number; // 0-1
  complexity: number; // 0-1
  level: ReadingLevel;
}

/**
 * Reading level options
 */
export type ReadingLevel = 'Toddler' | 'Student' | 'Expert';

// ============ Image Types ============

/**
 * Image generation result
 */
export interface ImageResult {
  imageUrl: string;
  blob: Blob;
  cached: boolean;
  width?: number;
  height?: number;
  seed?: number;
  negativePrompt?: string;
}

/**
 * Image cache metadata
 */
export interface ImageCacheMetadata {
  width: number;
  height: number;
  seed: number;
  negativePrompt?: string;
  cachedAt?: number;
}

// ============ Model Types ============

/**
 * Model status states
 */
export type ModelStatusType = 'Idle' | 'Loading' | 'Ready' | 'Error' | 'Unloaded';

/**
 * Model type identifier
 */
export type ModelType = 'text' | 'image' | 'fast' | 'quality';

/**
 * Model state information
 */
export interface ModelState {
  status: ModelStatusType;
  loading: boolean;
  progress: number;
  error: string | null;
  device: string | null;
  modelName?: string | null;
}

/**
 * WebGPU capabilities
 */
export interface WebGPUCapabilities {
  webgpu: boolean;
  shaderF16: boolean;
  adapterInfo?: GPUAdapterInfo;
  limits?: GPUSupportedLimits;
}

// ============ Device Resources ============

/**
 * Device resource information
 */
export interface DeviceResources {
  deviceMemory: number | null;
  hardwareConcurrency: number | null;
  hasWebGPU: boolean;
  hasShaderF16: boolean;
  isLowMemory: boolean;
  limitations: string[];
}

/**
 * Generation settings based on device capabilities
 */
export interface GenerationSettings {
  mode: 'quality' | 'speed' | 'extreme';
  imageSteps: number;
  imageResolution: {
    width: number;
    height: number;
  };
  skipImageGeneration: boolean;
  description: string;
}

// ============ Worker RPC Types ============

/**
 * RPC request from main thread to worker
 */
export interface WorkerRequest<T = unknown> {
  id: string;
  type: 'RPC_REQUEST';
  action: WorkerAction;
  payload: T;
}

/**
 * RPC response from worker to main thread
 */
export interface WorkerResponse<T = unknown> {
  id: string;
  type: 'RPC_RESPONSE';
  action: WorkerAction;
  result: T | null;
  error: string | null;
  status: 'success' | 'error';
}

/**
 * Worker-initiated event
 */
export interface WorkerEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

/**
 * Available worker actions
 */
export type WorkerAction =
  | 'INIT_MODELS'
  | 'GENERATE_TEXT'
  | 'GENERATE_IMAGE'
  | 'GENERATE_QUIP'
  | 'GENERATE_OUTLINE'
  | 'START_GENERATION'
  | 'RESUME_GENERATION'
  | 'CANCEL_GENERATION'
  | 'UNLOAD_MODELS'
  | 'GET_MODEL_STATUS';

/**
 * Worker action payload types
 */
export interface WorkerActionPayloads {
  INIT_MODELS: { modelTypes: ModelType[] };
  GENERATE_TEXT: { prompt: string; options: TextGenerationOptions };
  GENERATE_IMAGE: { prompt: string; options: ImageGenerationOptions };
  GENERATE_QUIP: { content: string };
  GENERATE_OUTLINE: { subject: string; settings: BookSettings; numPages: number };
  START_GENERATION: { settings: BookSettings; outline: OutlineItem[]; numPages: number };
  RESUME_GENERATION: Record<string, never>;
  CANCEL_GENERATION: Record<string, never>;
  UNLOAD_MODELS: { modelTypes: ModelType[] };
  GET_MODEL_STATUS: Record<string, never>;
}

// ============ Generation Options ============

/**
 * Text generation options
 */
export interface TextGenerationOptions {
  complexity?: number;
  maxTokens?: number;
  temperature?: number;
  doSample?: boolean;
  systemPrompt?: string;
  skipStatus?: boolean;
}

/**
 * Image generation options
 */
export interface ImageGenerationOptions {
  useCache?: boolean;
  skipCache?: boolean;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
}

// ============ Library & Storage ============

/**
 * IndexedDB book store record
 */
export interface BookStoreRecord extends Book {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Image cache store record
 */
export interface ImageCacheStoreRecord {
  id: string; // SHA hash of prompt
  blob: Blob;
  metadata: ImageCacheMetadata;
  createdAt: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  count: number;
  sizeBytes: number;
  sizeFormatted: string;
}

// ============ Component Props ============

/**
 * Control panel props
 */
export interface ControlPanelProps {
  settings: BookSettings;
  setSettings: (settings: BookSettings) => void;
  onGenerate: () => void;
  loading: boolean;
}

/**
 * Book renderer props
 */
export interface BookRendererProps {
  bookData: Page & { subject: string } | null;
  loading: boolean;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  hasOutline: boolean;
  generateImage: (prompt: string, options?: ImageGenerationOptions) => Promise<ImageResult | null>;
}

/**
 * Model status dashboard props
 */
export interface ModelStatusDashboardProps {
  // No props - uses useModel hook internally
}

/**
 * Narrator component props
 */
export interface NarratorProps {
  status: ModelStatusType;
  progress: number;
  quip: string | null | undefined;
  hasContent: boolean;
}

/**
 * Book library props
 */
export interface BookLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadBook: (book: Book) => void;
}

// ============ Hook Return Types ============

/**
 * useBookGeneration hook return type
 */
export interface UseBookGenerationReturn {
  bookData: Book | null;
  outline: OutlineItem[] | null;
  generatingPages: number[];
  generationError: string | null;
  isGenerating: boolean;
  startGeneration: (settings: BookSettings, numPages?: number) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  updatePageImage: (pageNum: number, newImage: ImageResult) => void;
  clearBook: () => void;
  parseOutline: (response: string, numPages?: number) => OutlineItem[];
}

/**
 * usePdfExport hook return type
 */
export interface UsePdfExportReturn {
  exporting: boolean;
  exportProgress: number;
  exportError: string | null;
  exportPDF: () => Promise<void>;
  cancelExport: () => void;
  resetExport: () => void;
}

/**
 * useModel hook return type (subset - see ModelContext for full type)
 */
export interface UseModelReturn {
  generateText: (prompt: string, options?: TextGenerationOptions) => Promise<string | null>;
  generateQuip: (content: string) => Promise<string | null>;
  generateOutline: (subject: string, settings: BookSettings, numPages: number) => Promise<string>;
  generateImage: (prompt: string, options?: ImageGenerationOptions) => Promise<ImageResult | null>;
  textModel: ModelState;
  qualityTextModel: ModelState;
  imageModel: ModelState;
  activeTextModel: 'fast' | 'quality';
  initTextModel: (modelType?: 'fast' | 'quality') => Promise<boolean>;
  initImageModel: () => Promise<boolean>;
  unloadTextModel: () => Promise<void>;
  unloadImageModel: () => Promise<void>;
  unloadAllModels: () => Promise<void>;
  startBookGeneration: (settings: BookSettings, outline: OutlineItem[], numPages: number) => Promise<void>;
  resumeBookGeneration: () => Promise<void>;
  cancelBookGeneration: () => Promise<void>;
  speedMode: boolean;
  toggleSpeedMode: (enabled: boolean) => void;
  getGenerationSettings: () => GenerationSettings;
  deviceResources: DeviceResources | null;
  webgpuCapabilities: WebGPUCapabilities | null;
  isWebGPUSupported: boolean;
  saveBookToDB: (bookData: Book) => Promise<string | null>;
  getSavedBook: (bookId: string) => Promise<Book | null>;
  getSavedBooks: () => Promise<Book[]>;
  deleteSavedBook: (bookId: string) => Promise<boolean>;
  fetchCacheStats: () => Promise<CacheStats>;
  clearImageCache: () => Promise<void>;
}

// ============ Utility Types ============

/**
 * Result type for async operations
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Nullable type helper
 */
export type Nullable<T> = T | null;

/**
 * Optional type helper
 */
export type Optional<T> = T | undefined;
