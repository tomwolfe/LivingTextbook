import { useState, useRef, useCallback } from 'react';
import { Txt2ImgWorkerClient, detectCapabilities } from 'web-txt2img';
import { env, AutoTokenizer } from '@huggingface/transformers';

// Singleton model client - prevents multiple loads and memory leaks
let modelClient = null;
let modelLoadPromise = null;

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
   * Initialize the model client (singleton pattern)
   * Call this early to pre-load the model while user is typing
   */
  const initModel = useCallback(async () => {
    if (initializedRef.current) {
      return true;
    }

    try {
      // Detect WebGPU capabilities using the standalone function
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

      // Create singleton client if not exists
      if (!modelClient) {
        modelClient = Txt2ImgWorkerClient.createDefault();
      }

      // Double-check capabilities via client
      const clientCaps = await modelClient.detect();
      console.log('Client capabilities:', clientCaps);

      // Load model with progress tracking (use sd-turbo for mobile-friendly size)
      // Provide tokenizer from @huggingface/transformers
      setStatus('Loading Model...');
      setLoading(true);

      modelLoadPromise = modelClient.load('sd-turbo', {
        backendPreference: ['webgpu'],
        // Provide tokenizer using @huggingface/transformers
        tokenizerProvider: async (text) => {
          // Lazy load tokenizer on first use
          if (!initModel.tokenizer) {
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            initModel.tokenizer = await AutoTokenizer.from_pretrained(
              'hf-internal-testing/clip-vit-base-patch32'
            );
          }
          const inputs = initModel.tokenizer(text, { 
            padding: true, 
            truncation: true, 
            max_length: 77 
          });
          return inputs.input_ids.data;
        },
      }, (progress) => {
        const pct = progress.pct != null ? Math.round(progress.pct) : null;
        const message = pct != null ? `Loading Model... ${pct}%` : 'Loading Model...';
        setStatus(message);
      });

      const loadResult = await modelLoadPromise;
      
      if (!loadResult?.ok) {
        throw new Error(loadResult?.message || 'Model load failed');
      }
      
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
  const generateImage = useCallback(async (prompt) => {
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

    setLoading(true);
    setStatus('Generating Image...');

    try {
      const { promise } = modelClient.generate(
        { 
          prompt, 
          seed: Math.floor(Math.random() * 1000000),
          width: 512,
          height: 512
        },
        (progress) => {
          if (progress.phase) {
            setStatus(`Generating: ${progress.phase}`);
          } else if (progress.pct != null) {
            setStatus(`Generating: ${Math.round(progress.pct)}%`);
          }
        },
        { busyPolicy: 'queue', debounceMs: 200 }
      );

      const result = await promise;
      
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
  const unloadModel = useCallback(async () => {
    if (modelClient) {
      await modelClient.unload();
      modelClient = null;
      modelLoadPromise = null;
      initializedRef.current = false;
      setStatus('Model Unloaded');
    }
  }, []);

  return { 
    generateImage, 
    initModel,
    unloadModel,
    loading, 
    status,
    webgpuSupported
  };
};
