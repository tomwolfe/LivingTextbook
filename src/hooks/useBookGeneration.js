import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * useBookGeneration Hook
 * Manages book generation lifecycle, outline parsing, and page state
 * 
 * @param {Object} options - Hook options
 * @param {Function} options.generateOutline - Function to generate outline from worker
 * @param {Function} options.startBookGeneration - Function to start generation in worker
 * @param {Function} options.resumeBookGeneration - Function to resume generation
 * @param {Function} options.cancelBookGeneration - Function to cancel generation
 * @returns {Object} Book generation state and handlers
 */
export function useBookGeneration({
  generateOutline,
  startBookGeneration,
  resumeBookGeneration,
  cancelBookGeneration,
} = {}) {
  const [bookData, setBookData] = useState(null);
  const [outline, setOutline] = useState(null);
  const [generatingPages, setGeneratingPages] = useState([]);
  const [generationError, setGenerationError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const pendingGenerationsRef = useRef(new Set());

  /**
   * Parse outline from LLM response with robust JSON extraction
   */
  const parseOutline = useCallback((response, numPages = 3) => {
    try {
      if (!response) return null;

      // Try to extract JSON from the response
      // First, strip markdown code blocks if present
      let cleanResponse = response;
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        cleanResponse = codeBlockMatch[1];
      }

      // Try to find JSON array in the response
      const jsonMatch = cleanResponse.match(/\[.*\]/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length === numPages) {
          // Validate schema
          const isValid = parsed.every(item => 
            item && typeof item === 'object' && 
            typeof item.title === 'string' && 
            typeof item.focus === 'string'
          );
          if (isValid) {
            return parsed;
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse outline, using fallback:', err);
    }

    // Fallback outline
    return Array.from({ length: numPages }, (_, i) => ({
      title: `Page ${i + 1}`,
      focus: `Continue explaining the topic`
    }));
  }, []);

  /**
   * Handle worker generation events
   */
  useEffect(() => {
    const handleWorkerEvent = (event) => {
      const { type, payload } = event.detail || {};

      switch (type) {
        case 'PAGE_START': {
          const { pageNum } = payload || {};
          setGeneratingPages(prev => [...prev, pageNum]);
          break;
        }

        case 'PAGE_COMPLETE': {
          const { pageNum, pageData } = payload || {};
          setBookData(prev => {
            const newPages = [...(prev?.pages || [])];
            newPages[pageNum] = pageData;
            return { ...prev, pages: newPages };
          });
          setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          break;
        }

        case 'PAGE_ERROR': {
          const { pageNum, error } = payload || {};
          console.error(`Page ${pageNum} error:`, error);
          setGenerationError(error);
          setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          break;
        }

        case 'QUEUE_COMPLETE':
        case 'GENERATION_CANCELLED':
          pendingGenerationsRef.current.clear();
          setGeneratingPages([]);
          setIsGenerating(false);
          break;

        default:
          break;
      }
    };

    window.addEventListener('worker-generation-event', handleWorkerEvent);
    return () => {
      window.removeEventListener('worker-generation-event', handleWorkerEvent);
    };
  }, []);

  /**
   * Start generating a book
   */
  const startGeneration = useCallback(async (settings, numPages = 3) => {
    if (!settings?.subject || !generateOutline || !startBookGeneration) {
      throw new Error('Missing required parameters or functions');
    }

    // Reset state
    setBookData(null);
    setOutline(null);
    setGenerationError(null);
    setGeneratingPages([]);
    pendingGenerationsRef.current.clear();
    setIsGenerating(true);

    try {
      // Step 1: Generate outline
      const outlineResponse = await generateOutline(settings.subject, settings, numPages);
      const parsedOutline = parseOutline(outlineResponse, numPages);
      setOutline(parsedOutline);

      // Step 2: Initialize book data structure
      setBookData({
        subject: settings.subject,
        pages: Array(numPages).fill(null),
        settings: { ...settings }
      });

      // Step 3: Start generation in worker
      await startBookGeneration(settings, parsedOutline, numPages);

      // Step 4: Resume generation after delay
      setTimeout(async () => {
        if (resumeBookGeneration) {
          await resumeBookGeneration();
        }
      }, 500);

    } catch (err) {
      console.error('Generation failed:', err);
      setGenerationError(err.message || 'Generation failed');
      setBookData(null);
      setIsGenerating(false);
      throw err;
    }
  }, [generateOutline, startBookGeneration, resumeBookGeneration, parseOutline]);

  /**
   * Cancel ongoing generation
   */
  const cancelGeneration = useCallback(async () => {
    if (cancelBookGeneration) {
      await cancelBookGeneration();
    }
    setGeneratingPages([]);
    setIsGenerating(false);
    pendingGenerationsRef.current.clear();
  }, [cancelBookGeneration]);

  /**
   * Update a page's image
   */
  const updatePageImage = useCallback((pageNum, newImage) => {
    setBookData(prev => {
      if (!prev) return prev;
      const newPages = [...(prev.pages || [])];
      if (newPages[pageNum]) {
        newPages[pageNum] = {
          ...newPages[pageNum],
          image: newImage,
        };
      }
      return { ...prev, pages: newPages };
    });
  }, []);

  /**
   * Clear book data
   */
  const clearBook = useCallback(() => {
    setBookData(null);
    setOutline(null);
    setGeneratingPages([]);
    setGenerationError(null);
    setIsGenerating(false);
    pendingGenerationsRef.current.clear();
  }, []);

  return {
    // State
    bookData,
    outline,
    generatingPages,
    generationError,
    isGenerating,

    // Actions
    startGeneration,
    cancelGeneration,
    updatePageImage,
    clearBook,
    
    // Utilities
    parseOutline,
  };
}

export default useBookGeneration;
