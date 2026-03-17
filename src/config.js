/**
 * Centralized configuration for AI models and application settings
 * Extracted from hooks to enable easy model swapping and configuration updates
 */

export const config = {
  // Text Generation Model Configuration
  textGen: {
    // WebGPU-optimized model (quantized for smaller footprint)
    // Using MHA variant for better performance
    modelIdWebGPU: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
    // Fallback CPU model (same model, different execution)
    modelIdCPU: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
    // Alternative: Even smaller model (360M params but more quantized)
    // modelIdWebGPU: 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX',
    // modelIdCPU: 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX',
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
