import { useState, useEffect, useRef } from 'react';
import { pipeline } from '@xenova/transformers';

export const useTextGen = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const generator = useRef(null);

  useEffect(() => {
    // Initializing generator on first load or on demand
  }, []);

  const initGenerator = async () => {
    if (generator.current) return;
    
    setLoading(true);
    setStatus('Loading Model...');
    try {
      generator.current = await pipeline('text-generation', 'Xenova/SmolLM2-135M-Instruct', {
        progress_callback: (p) => {
          if (p.status === 'progress') {
            setProgress(p.progress.toFixed(2));
          }
        },
        device: 'webgpu' // Attempt WebGPU, falls back automatically in newer Transformers.js
      });
      setStatus('Model Ready');
    } catch (err) {
      console.warn("WebGPU not available, falling back to CPU", err);
      try {
        generator.current = await pipeline('text-generation', 'Xenova/SmolLM2-135M-Instruct', {
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
