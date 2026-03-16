import { useState, useRef, useCallback } from 'react';
import { loadModel, generateImage, unloadModel, detectCapabilities } from 'web-txt2img';
import { env, AutoTokenizer } from '@huggingface/transformers';

// Singleton state - prevents multiple loads and memory leaks
let modelLoaded = false;
let modelLoadPromise = null;
let tokenizer = null;

/**
 * Hook for WebGPU-accelerated text-to-image generation using web-txt2img
 * Implements singleton pattern for model loading to prevent memory leaks
 */
export const useImageGen = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [webgpuSupported, setWebgpuSupported] = useState(true);
  const initializedRef = useRef(false);

  /**
   * Initialize the model (singleton pattern)
   * Call this early to pre-load the model while user is typing
   */
  const initModel = useCallback(async () => {
    if (initializedRef.current) {
      return true;
    }

    try {
      // Check WebGPU capabilities
      const caps = await detectCapabilities();
      console.log('WebGPU capabilities:', caps);
      
      if (!caps.webgpu || !caps.shaderF16) {
        setWebgpuSupported(false);
        console.warn('WebGPU not fully supported:', { 
          webgpu: caps.webgpu, 
          shaderF16: caps.shaderF16 
        });
        return false;
      }

      // Load tokenizer first (CLIP for SD-Turbo)
      setStatus('Loading Tokenizer...');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      tokenizer = await AutoTokenizer.from_pretrained('hf-internal-testing/clip-vit-base-patch32');
      console.log('Tokenizer loaded');

      // Load model with progress tracking (use sd-turbo for mobile-friendly size)
      setStatus('Loading Model...');
      setLoading(true);

      modelLoadPromise = loadModel('sd-turbo', {
        backendPreference: ['webgpu'],
      }, (progress) => {
        const pct = progress.pct != null ? Math.round(progress.pct) : null;
        const message = pct != null ? `Loading Model... ${pct}%` : 'Loading Model...';
        setStatus(message);
      });

      const loadResult = await modelLoadPromise;
      
      if (!loadResult?.ok) {
        throw new Error(loadResult?.message || 'Model load failed');
      }
      
      modelLoaded = true;
      initializedRef.current = true;
      setStatus('Model Ready');
      setLoading(false);
      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU model:', error);
      setWebgpuSupported(false);
      setStatus(`Error: ${error.message}`);
      setLoading(false);
      return false;
    }
  }, []);

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - The text description of the image to generate
   * @returns {Promise<string|null>} - Object URL of the generated image, or null on failure
   */
  const generateImageFromPrompt = useCallback(async (prompt) => {
    // Auto-initialize if not already done
    if (!initializedRef.current) {
      const initialized = await initModel();
      if (!initialized) {
        return null;
      }
    }

    // Wait for any ongoing load to complete
    if (modelLoadPromise) {
      await modelLoadPromise;
    }

    if (!modelLoaded) {
      console.error('Model not loaded');
      return null;
    }

    setLoading(true);
    setStatus('Generating Image...');

    try {
      const result = await generateImage({
        model: 'sd-turbo',
        prompt, 
        seed: Math.floor(Math.random() * 1000000),
        width: 512,
        height: 512,
      });
      
      if (result?.ok && result?.blob) {
        // Create Object URL from the generated blob
        const imageUrl = URL.createObjectURL(result.blob);
        setStatus('Image Generated');
        setLoading(false);
        return imageUrl;
      } else {
        console.error('Generation failed:', result);
        setStatus(`Generation Failed: ${result?.message || 'Unknown error'}`);
        setLoading(false);
        return null;
      }
    } catch (error) {
      console.error('Image generation error:', error);
      setStatus(`Error: ${error.message}`);
      setLoading(false);
      return null;
    }
  }, [initModel]);

  /**
   * Cleanup function to unload the model and free memory
   * Call this when component unmounts or when switching to a different feature
   */
  const unloadModelCallback = useCallback(async () => {
    if (modelLoaded) {
      await unloadModel('sd-turbo');
      modelLoaded = false;
      modelLoadPromise = null;
      tokenizer = null;
      initializedRef.current = false;
      setStatus('Model Unloaded');
    }
  }, []);

  return { 
    generateImage: generateImageFromPrompt, 
    initModel,
    unloadModel: unloadModelCallback,
    loading, 
    status,
    webgpuSupported
  };
};
