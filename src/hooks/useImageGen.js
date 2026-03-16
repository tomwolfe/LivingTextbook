import { useState, useRef, useCallback } from 'react';
import { Txt2ImgWorkerClient } from 'web-txt2img';

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
      // Detect WebGPU capabilities
      const caps = await Txt2ImgWorkerClient.detect();
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

      // Load model with progress tracking (use sd-turbo for mobile-friendly size)
      setStatus('Loading Model...');
      setLoading(true);

      modelLoadPromise = modelClient.load('sd-turbo', {
        backendPreference: ['webgpu'],
      }, (progress) => {
        const pct = Math.round(progress.pct * 100);
        setStatus(`Loading Model... ${pct}%`);
      });

      await modelLoadPromise;
      initializedRef.current = true;
      setStatus('Model Ready');
      setLoading(false);
      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU model:', error);
      setWebgpuSupported(false);
      setStatus('Error: WebGPU not supported');
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
          }
        },
        { busyPolicy: 'queue', debounceMs: 200 }
      );

      const result = await promise;
      
      if (result.ok) {
        // Create Object URL from the generated blob
        const imageUrl = URL.createObjectURL(result.blob);
        setStatus('Image Generated');
        setLoading(false);
        return imageUrl;
      } else {
        console.error('Generation failed:', result.error);
        setStatus('Generation Failed');
        setLoading(false);
        return null;
      }
    } catch (error) {
      console.error('Image generation error:', error);
      setStatus('Error: Generation failed');
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
