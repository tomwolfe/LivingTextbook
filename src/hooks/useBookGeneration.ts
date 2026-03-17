import { useState, useCallback, useRef, useEffect } from 'react';
import type { 
  Book, 
  OutlineItem, 
  BookSettings, 
  ImageResult,
  UseBookGenerationReturn 
} from '../types';

/**
 * useBookGeneration Hook
 * Manages book generation lifecycle, outline parsing, and page state
 *
 * @param options - Hook options
 * @param options.generateOutline - Function to generate outline from worker
 * @param options.startBookGeneration - Function to start generation in worker
 * @param options.cancelBookGeneration - Function to cancel generation
 * @returns Book generation state and handlers
 */
export function useBookGeneration({
  generateOutline,
  startBookGeneration,
  cancelBookGeneration,
}: {
  generateOutline?: (subject: string, settings: BookSettings, numPages: number) => Promise<string>;
  startBookGeneration?: (settings: BookSettings, outline: OutlineItem[], numPages: number) => Promise<void>;
  cancelBookGeneration?: () => Promise<void>;
} = {}): UseBookGenerationReturn {
  const [bookData, setBookData] = useState<Book | null>(null);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [generatingPages, setGeneratingPages] = useState<number[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const pendingGenerationsRef = useRef<Set<number>>(new Set());

  /**
   * Parse outline from LLM response with robust JSON extraction
   */
  const parseOutline = useCallback((response: string, numPages: number = 3): OutlineItem[] => {
    try {
      if (!response) {
        return createFallbackOutline(numPages);
      }

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
          const isValid = parsed.every((item: unknown) =>
            item && typeof item === 'object' &&
            'title' in item && typeof item.title === 'string' &&
            'focus' in item && typeof item.focus === 'string'
          );
          if (isValid) {
            return parsed as OutlineItem[];
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse outline with JSON, trying string-matching fallback:', err);
    }

    // Try string-matching fallback before giving up
    const stringMatchedOutline = parseOutlineWithStringMatching(response, numPages);
    if (stringMatchedOutline && stringMatchedOutline.length > 0) {
      console.log('Successfully parsed outline with string-matching fallback');
      return stringMatchedOutline;
    }

    // Final fallback outline
    console.warn('All parsing failed, using default fallback outline');
    return createFallbackOutline(numPages);
  }, []);

  /**
   * Fallback outline generator
   */
  const createFallbackOutline = useCallback((numPages: number): OutlineItem[] => {
    return Array.from({ length: numPages }, (_, i) => ({
      title: `Page ${i + 1}`,
      focus: `Continue explaining the topic`
    }));
  }, []);

  /**
   * Parse outline by extracting title/focus lines from text
   * This is a robust fallback when JSON parsing fails
   */
  const parseOutlineWithStringMatching = useCallback((response: string | null | undefined, numPages: number): OutlineItem[] | null => {
    if (!response) return null;

    const outline: OutlineItem[] = [];
    const lines = response.split('\n');
    
    let currentTitle: string | null = null;
    let currentFocus: string | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for title patterns: "title:", "Title:", "1.", "Page 1:", etc.
      const titleMatch = trimmedLine.match(/^(?:title|page\s*\d*:?|\d+\.)\s*:?\s*(.+)$/i);
      if (titleMatch) {
        // If we had a previous title without focus, save it with default focus
        if (currentTitle && !currentFocus) {
          outline.push({ title: currentTitle, focus: 'Content to be generated' });
        }
        currentTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '');
        currentFocus = null;
        continue;
      }

      // Look for focus patterns: "focus:", "Focus:", "Description:", etc.
      const focusMatch = trimmedLine.match(/^(?:focus|description|topic)\s*:?\s*(.+)$/i);
      if (focusMatch && currentTitle) {
        currentFocus = focusMatch[1].trim().replace(/^["']|["']$/g, '');
        outline.push({ title: currentTitle, focus: currentFocus });
        currentTitle = null;
        currentFocus = null;
        continue;
      }

      // Look for numbered list items that might be titles
      const numberedMatch = trimmedLine.match(/^(\d+)\.\s*(.+)$/);
      if (numberedMatch && outline.length < numPages) {
        // If we had a previous title without focus, save it
        if (currentTitle && !currentFocus) {
          outline.push({ title: currentTitle, focus: 'Content to be generated' });
        }
        currentTitle = numberedMatch[2].trim();
        currentFocus = null;
      }
    }

    // Handle last item if it has a title but no focus
    if (currentTitle && !currentFocus) {
      outline.push({ title: currentTitle, focus: 'Content to be generated' });
    }

    // Validate we have enough pages
    if (outline.length === numPages) {
      return outline;
    }

    // If we have some valid items but not enough, pad with defaults
    if (outline.length > 0 && outline.length < numPages) {
      const remaining = numPages - outline.length;
      for (let i = 0; i < remaining; i++) {
        outline.push({
          title: `Page ${outline.length + i + 1}`,
          focus: 'Continue explaining the topic'
        });
      }
      return outline;
    }

    return null;
  }, []);

  /**
   * Handle worker generation events
   */
  useEffect(() => {
    const handleWorkerEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{
        type: string;
        payload?: { pageNum?: number; pageData?: Book['pages'][number]; error?: string };
      }>;
      const { type, payload } = customEvent.detail || {};

      switch (type) {
        case 'PAGE_START': {
          const { pageNum } = payload || {};
          if (pageNum !== undefined) {
            setGeneratingPages(prev => [...prev, pageNum]);
          }
          break;
        }

        case 'PAGE_COMPLETE': {
          const { pageNum, pageData } = payload || {};
          if (pageNum !== undefined && pageData) {
            setBookData(prev => {
              if (!prev) return prev;
              const newPages = [...(prev.pages || [])];
              
              // Reconstruct image from buffer if needed
              let processedPageData = pageData;
              const imageData = pageData.image as unknown as { buffer?: ArrayBuffer; type?: string; imageUrl?: string; blob?: Blob; cached?: boolean } | null | undefined;
              if (imageData && imageData.buffer && !imageData.imageUrl) {
                try {
                  const { buffer, type } = imageData;
                  const blob = new Blob([buffer], { type: type || 'image/png' });
                  const imageUrl = URL.createObjectURL(blob);
                  processedPageData = {
                    ...pageData,
                    image: {
                      imageUrl,
                      blob,
                      cached: imageData.cached || false,
                    },
                  };
                } catch (err) {
                  console.error('Failed to reconstruct image from buffer:', err);
                }
              }
              
              newPages[pageNum] = processedPageData;
              return { ...prev, pages: newPages };
            });
            setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          }
          break;
        }

        case 'PAGE_ERROR': {
          const { pageNum, error } = payload || {};
          console.error(`Page ${pageNum} error:`, error);
          setGenerationError(error || 'Page generation failed');
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

    window.addEventListener('worker-generation-event', handleWorkerEvent as EventListener);
    return () => {
      window.removeEventListener('worker-generation-event', handleWorkerEvent as EventListener);
    };
  }, []);

  /**
   * Start generating a book
   */
  const startGeneration = useCallback(async (settings: BookSettings, numPages: number = 3): Promise<void> => {
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
      // The worker will process the queue asynchronously - no need for resume call
      await startBookGeneration(settings, parsedOutline, numPages);

    } catch (err) {
      console.error('Generation failed:', err);
      setGenerationError((err as Error).message || 'Generation failed');
      setBookData(null);
      setIsGenerating(false);
      throw err;
    }
  }, [generateOutline, startBookGeneration, parseOutline]);

  /**
   * Cancel ongoing generation
   */
  const cancelGeneration = useCallback(async (): Promise<void> => {
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
  const updatePageImage = useCallback((pageNum: number, newImage: ImageResult): void => {
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
  const clearBook = useCallback((): void => {
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
