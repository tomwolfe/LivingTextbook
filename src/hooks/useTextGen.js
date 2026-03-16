import { useState, useEffect, useRef } from 'react';
import { pipeline, env } from '@huggingface/transformers'; // 1. Use the new package

// 2. Modern configuration to avoid local lookups and use caching
env.allowLocalModels = false;
env.useBrowserCache = true;

export const useTextGen = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const generator = useRef(null);

  const initGenerator = async () => {
    if (generator.current) return;
    
    setLoading(true);
    setStatus('Loading Model...');
    try {
      // 3. Recommended model for browser use
      const modelId = 'onnx-community/SmolLM2-135M-Instruct'; 
      
      generator.current = await pipeline('text-generation', modelId, {
        device: 'webgpu', // Uses the faster WebGPU backend
        progress_callback: (p) => {
          if (p.status === 'progress') {
            setProgress(p.progress.toFixed(2));
          }
        },
      });
      setStatus('Model Ready (WebGPU)');
    } catch (err) {
      console.warn("WebGPU not available or failed, falling back to CPU", err);
      try {
        const modelId = 'onnx-community/SmolLM2-135M-Instruct';
        generator.current = await pipeline('text-generation', modelId, {
            progress_callback: (p) => {
              if (p.status === 'progress') {
                setProgress(p.progress.toFixed(2));
              }
            }
          });
          setStatus('Model Ready (CPU)');
      } catch (innerErr) {
        setStatus('Error loading model');
        console.error(innerErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const generateText = async (prompt) => {
    if (!generator.current) await initGenerator();
    
    setLoading(true);
    setStatus('Generating Content...');
    try {
      const messages = [
        { role: "system", content: "You are a helpful educational assistant." },
        { role: "user", content: prompt }
      ];

      const output = await generator.current(messages, {
        max_new_tokens: 150,
        temperature: 0.7,
        do_sample: true,
      });

      setStatus('Generation Complete');
      // Extract content from chat format
      return output[0].generated_text[output[0].generated_text.length - 1].content;
    } catch (err) {
      setStatus('Generation Error');
      console.error(err);
      return "Something went wrong during text generation.";
    } finally {
      setLoading(false);
    }
  };

  return { generateText, loading, progress, status, initGenerator };
};
