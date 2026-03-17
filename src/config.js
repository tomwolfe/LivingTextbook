/**
 * Centralized configuration for AI models and application settings
 * Extracted from hooks to enable easy model swapping and configuration updates
 */

export const config = {
  // Text Generation Model Configuration
  textGen: {
    // Fast model (quantized for smaller footprint) - for low complexity
    // Using MHA variant for better performance
    fastModelId: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
    // Quality model - for high complexity content
    qualityModelId: 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX',
    // Fallback CPU models
    fastModelIdCPU: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
    qualityModelIdCPU: 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX',
    // Complexity threshold for switching models (0-1)
    complexityThreshold: 0.7,
    // Generation parameters
    maxNewTokens: 150,
    temperature: 0.7,
    doSample: true,
  },

  // Image Generation Model Configuration
  imageGen: {
    modelId: 'sd-turbo',
    // Tokenizer model for SD-Turbo
    tokenizerModel: 'Xenova/clip-vit-base-patch16',
    width: 512,
    height: 512,
    seedRange: { min: 0, max: 1000000 },
    // Speed mode settings (for low-memory devices)
    speedModeWidth: 384,
    speedModeHeight: 384,
    speedModeSteps: 2,
    // Extreme speed mode (text-only or very low res)
    extremeSpeedModeWidth: 256,
    extremeSpeedModeHeight: 256,
    // Note: For smaller image models, consider:
    // - 'tiny-sd' (smaller but lower quality)
    // - 'latent-consistency-model' (faster inference)
  },

  // Transformers.js Environment Settings
  transformers: {
    allowLocalModels: false,
    useBrowserCache: true,
    logLevel: 'error',
  },

  // WebGPU Detection Settings
  webgpu: {
    requireShaderF16: true,
  },

  // UI/UX Settings
  ui: {
    defaultSettings: {
      subject: '',
      tone: 0.5,
      style: 0.5,
      complexity: 0.5,
      level: 'Student',
    },
    levelOptions: ['Toddler', 'Student', 'Expert'],
    // Number of pages to generate per book
    defaultNumPages: 3,
  },
};

export default config;
