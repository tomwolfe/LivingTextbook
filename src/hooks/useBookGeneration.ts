import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Book,
  OutlineItem,
  BookSettings,
  ImageResult,
  UseBookGenerationReturn,
  PageState,
  PageStatus,
  AppError,
} from '../types';
import { toAppError, isCancellation } from '../utils/errors';
import { generationLogger } from '../utils/logger';

/**
 * Create initial page state
 */
function createInitialPageState(): PageState {
  return {
    status: 'idle',
    content: undefined,
    image: undefined,
    quip: undefined,
    error: undefined,
    retryCount: 0,
  };
}

/**
 * Create book with page states
 */
function createBookWithStates(subject: string, numPages: number, settings: BookSettings): Book & { pageStates: PageState[] } {
  return {
    subject,
    pages: Array(numPages).fill(null),
    settings: { ...settings },
    pageStates: Array.from({ length: numPages }, () => createInitialPageState()),
  };
}

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
  subscribeToWorkerEvents,
}: {
  generateOutline?: (subject: string, settings: BookSettings, numPages: number) => Promise<string>;
  startBookGeneration?: (settings: BookSettings, outline: OutlineItem[], numPages: number) => Promise<void>;
  cancelBookGeneration?: () => Promise<void>;
  subscribeToWorkerEvents?: (callback: (data: { type: string; payload?: Record<string, unknown> }) => void) => () => void;
} = {}): UseBookGenerationReturn {
  const [bookData, setBookData] = useState<(Book & { pageStates?: PageState[] }) | null>(null);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [generationError, setGenerationError] = useState<AppError | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const pendingGenerationsRef = useRef<Set<number>>(new Set());
  // Track generated image URLs to prevent memory leaks
  const generatedImageUrlsRef = useRef<Set<string>>(new Set());

  /**
   * Get current page status
   */
  const getPageStatus = useCallback((pageNum: number): PageStatus => {
    if (!bookData?.pageStates?.[pageNum]) {
      return 'idle';
    }
    return bookData.pageStates[pageNum].status;
  }, [bookData]);

  /**
   * Get generating pages (for backward compatibility)
   */
  const generatingPages = bookData?.pageStates
    ? bookData.pageStates
        .map((page, idx) => (page.status === 'generating' ? idx : -1))
        .filter(idx => idx !== -1)
    : [];

  /**
   * Extract JSON array from LLM response using robust bracket matching
   * Finds the first '[' and last ']' to handle conversational filler
   */
  const extractJsonArray = useCallback((text: string): string | null => {
    if (!text) return null;

    // First, try to extract from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const codeBlockContent = codeBlockMatch[1].trim();
      // Verify it's actually a JSON array
      if (codeBlockContent.startsWith('[') && codeBlockContent.endsWith(']')) {
        return codeBlockContent;
      }
      // If code block exists but doesn't contain array, search within it
      const firstBracket = codeBlockContent.indexOf('[');
      const lastBracket = codeBlockContent.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        return codeBlockContent.substring(firstBracket, lastBracket + 1);
      }
    }

    // No code block, search the entire text
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      return text.substring(firstBracket, lastBracket + 1);
    }

    return null;
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
   * Parse outline from LLM response with robust JSON extraction
   */
  const parseOutline = useCallback((response: string, numPages: number = 3): OutlineItem[] => {
    try {
      if (!response) {
        return createFallbackOutline(numPages);
      }

      // Extract JSON array using robust bracket matching
      const jsonArray = extractJsonArray(response);

      if (jsonArray) {
        try {
          const parsed = JSON.parse(jsonArray);
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
        } catch (jsonErr) {
          console.warn('JSON parsing failed, trying string-matching fallback:', jsonErr);
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
  }, [extractJsonArray, createFallbackOutline, parseOutlineWithStringMatching]);

  /**
   * Handle worker generation events via context subscription
   */
  useEffect(() => {
    if (!subscribeToWorkerEvents) return;

    const handleWorkerEvent = (data: {
      type: string;
      payload?: { pageNum?: number; pageData?: Book['pages'][number]; error?: string };
    }) => {
      const { type, payload } = data;

      switch (type) {
        case 'PAGE_START': {
          const { pageNum } = payload || {};
          if (pageNum !== undefined) {
            generationLogger.debug(`Page ${pageNum} started generation`);
            setBookData(prev => {
              if (!prev || !prev.pageStates) return prev;
              const newPageStates = [...prev.pageStates];
              newPageStates[pageNum] = {
                ...newPageStates[pageNum],
                status: 'generating',
                error: undefined,
              };
              return { ...prev, pageStates: newPageStates };
            });
          }
          break;
        }

        case 'PAGE_COMPLETE': {
          const { pageNum, pageData } = payload || {};
          if (pageNum !== undefined && pageData) {
            generationLogger.debug(`Page ${pageNum} generation complete`);
            setBookData(prev => {
              if (!prev) return prev;
              const newPages = [...(prev.pages || [])];

              // Revoke old blob URL if it exists to prevent memory leaks
              const oldPage = newPages[pageNum];
              if (oldPage?.image?.imageUrl?.startsWith('blob:')) {
                try {
                  URL.revokeObjectURL(oldPage.image.imageUrl);
                  generatedImageUrlsRef.current.delete(oldPage.image.imageUrl);
                } catch (err) {
                  generationLogger.warn('Failed to revoke old blob URL', { error: err as Error });
                }
              }

              // Reconstruct image from buffer if needed
              let processedPageData = pageData;
              const imageData = pageData.image as unknown as { buffer?: ArrayBuffer; type?: string; imageUrl?: string; blob?: Blob; cached?: boolean } | null | undefined;
              if (imageData && imageData.buffer && !imageData.imageUrl) {
                try {
                  const { buffer, type } = imageData;
                  const blob = new Blob([buffer], { type: type || 'image/png' });
                  const imageUrl = URL.createObjectURL(blob);
                  generatedImageUrlsRef.current.add(imageUrl);
                  processedPageData = {
                    ...pageData,
                    image: {
                      imageUrl,
                      blob,
                      cached: imageData.cached || false,
                    },
                  };
                } catch (err) {
                  generationLogger.error('Failed to reconstruct image from buffer', err as Error);
                }
              }

              newPages[pageNum] = processedPageData;

              // Update page state
              const newPageStates = [...(prev.pageStates || [])];
              const currentState = newPageStates[pageNum];
              newPageStates[pageNum] = {
                status: 'complete',
                content: pageData.content,
                image: processedPageData.image,
                quip: pageData.quip,
                settings: pageData.settings,
                retryCount: currentState?.retryCount || 0,
              };

              return { ...prev, pages: newPages, pageStates: newPageStates };
            });
          }
          break;
        }

        case 'PAGE_ERROR': {
          const { pageNum, error } = payload || {};
          if (pageNum === undefined) break;
          
          const appError = toAppError(new Error(error || 'Page generation failed'), `Page ${pageNum}`);
          generationLogger.error(`Page ${pageNum} error`, { error: appError });

          setGenerationError(appError);
          setBookData(prev => {
            if (!prev || !prev.pageStates) return prev;
            const newPageStates = [...prev.pageStates];
            newPageStates[pageNum] = {
              ...newPageStates[pageNum],
              status: 'error',
              error: error || 'Page generation failed',
            };
            return { ...prev, pageStates: newPageStates };
          });
          break;
        }

        case 'QUEUE_COMPLETE':
        case 'GENERATION_CANCELLED':
          pendingGenerationsRef.current.clear();
          setIsGenerating(false);
          generationLogger.info('Generation queue complete');
          break;

        default:
          break;
      }
    };

    // Subscribe to worker events via context
    const unsubscribe = subscribeToWorkerEvents(handleWorkerEvent);
    return () => {
      unsubscribe();
    };
  }, [subscribeToWorkerEvents]);

  /**
   * Start generating a book
   */
  const startGeneration = useCallback(async (settings: BookSettings, numPages: number = 3): Promise<void> => {
    if (!settings?.subject || !generateOutline || !startBookGeneration) {
      throw new Error('Missing required parameters or functions');
    }

    generationLogger.info(`Starting book generation: "${settings.subject}" (${numPages} pages)`);

    // Reset state
    setBookData(null);
    setOutline(null);
    setGenerationError(null);
    pendingGenerationsRef.current.clear();
    setIsGenerating(true);

    try {
      // Step 1: Generate outline
      generationLogger.debug('Generating outline...');
      const outlineResponse = await generateOutline(settings.subject, settings, numPages);
      const parsedOutline = parseOutline(outlineResponse, numPages);
      setOutline(parsedOutline);

      // Step 2: Initialize book data structure with page states
      const initialBook = createBookWithStates(settings.subject, numPages, settings);
      // Mark all pages as queued
      initialBook.pageStates = initialBook.pageStates.map((state, idx) => ({
        ...state,
        status: idx < parsedOutline.length ? 'queued' : 'idle',
      }));
      setBookData(initialBook);

      // Step 3: Start generation in worker
      generationLogger.debug('Starting worker generation...');
      await startBookGeneration(settings, parsedOutline, numPages);

    } catch (err) {
      const appError = toAppError(err, 'Book generation');
      generationLogger.error('Generation failed', appError);
      
      if (!isCancellation(err)) {
        setGenerationError(appError);
      }
      setBookData(null);
      setIsGenerating(false);
      throw err;
    }
  }, [generateOutline, startBookGeneration, parseOutline]);

  /**
   * Cancel ongoing generation
   */
  const cancelGeneration = useCallback(async (): Promise<void> => {
    generationLogger.info('Cancelling generation');
    
    if (cancelBookGeneration) {
      await cancelBookGeneration();
    }
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
        // Revoke old blob URL if it exists to prevent memory leaks
        const oldImage = newPages[pageNum].image;
        if (oldImage?.imageUrl?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(oldImage.imageUrl);
            generatedImageUrlsRef.current.delete(oldImage.imageUrl);
          } catch (err) {
            console.warn('Failed to revoke old blob URL in updatePageImage:', err);
          }
        }

        // Add new URL to tracking if it's a blob
        if (newImage.imageUrl.startsWith('blob:')) {
          generatedImageUrlsRef.current.add(newImage.imageUrl);
        }

        newPages[pageNum] = {
          ...newPages[pageNum],
          image: newImage,
        };
      }
      return { ...prev, pages: newPages };
    });
  }, []);

  /**
   * Load a saved book and hydrate page states
   */
  const loadBook = useCallback((book: Book): void => {
    generationLogger.info('Loading saved book', { subject: book.subject, pages: book.pages.length });

    // Revoke any existing generated image URLs first
    generatedImageUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        generationLogger.warn('Failed to revoke blob URL', { error: err as Error });
      }
    });
    generatedImageUrlsRef.current.clear();

    // Hydrate page states from saved book data
    const pageStates: PageState[] = book.pages.map((page, idx) => {
      const state: PageState = {
        status: page ? 'complete' : 'idle',
        content: page?.content,
        image: page?.image,
        quip: page?.quip,
        settings: page?.settings,
        retryCount: 0,
      };

      // Track blob URLs from loaded images
      if (page?.image?.imageUrl?.startsWith('blob:')) {
        generatedImageUrlsRef.current.add(page.image.imageUrl);
      }

      return state;
    });

    setBookData({ ...book, pageStates });
    setOutline(null);
    setGenerationError(null);
    setIsGenerating(false);
    pendingGenerationsRef.current.clear();
  }, []);

  /**
   * Clear book data and revoke all generated image URLs
   */
  const clearBook = useCallback((): void => {
    generationLogger.debug('Clearing book data');

    // Revoke all generated image URLs to prevent memory leaks
    generatedImageUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        generationLogger.warn('Failed to revoke blob URL', { error: err as Error });
      }
    });
    generatedImageUrlsRef.current.clear();

    setBookData(null);
    setOutline(null);
    setGenerationError(null);
    setIsGenerating(false);
    pendingGenerationsRef.current.clear();
  }, []);

  /**
   * Cleanup generated image URLs on unmount
   */
  useEffect(() => {
    return () => {
      generatedImageUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {
          console.warn('Failed to revoke blob URL on unmount:', err);
        }
      });
      generatedImageUrlsRef.current.clear();
    };
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
    loadBook,

    // Utilities
    parseOutline,
    getPageStatus,
  };
}

export default useBookGeneration;
