import { useState, useRef } from 'react';

// NOTE: Running Stable Diffusion in the browser is heavy (~400MB+ download).
// This hook is structured to be ready for Transformers.js image-to-image or text-to-image
// but uses a placeholder service for the initial prototype to ensure immediate usability.

export const useImageGen = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Idle');

  const generateImage = async (prompt) => {
    setLoading(true);
    setStatus('Generating Image...');
    
    // Simulate generation delay
    await new Promise(r => setTimeout(r, 1500));

    // For the prototype, we use a high-quality placeholder based on the prompt
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://pollinations.ai/p/${encodedPrompt}?width=512&height=512&seed=${Math.floor(Math.random()*1000)}&nologo=true`;
    
    setStatus('Image Generated');
    setLoading(false);
    return imageUrl;
  };

  return { generateImage, loading, status };
};
