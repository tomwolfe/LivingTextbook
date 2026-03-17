import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ModelProvider, useModel } from './contexts/ModelContext';
import ControlPanel from './components/ControlPanel';
import BookRenderer from './components/BookRenderer';
import Narrator from './components/Narrator';
import ModelStatusDashboard from './components/ModelStatusDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import BookLibrary from './components/BookLibrary';
import { generatePrompt, generateOutlinePrompt, generateQuipPrompt } from './utils/promptEngine';
import { config } from './config';
import './App.css';

const NUM_PAGES = 3;

/**
 * Main app content wrapped in ModelProvider
 */
function AppContent() {
  const [settings, setSettings] = useState(config.ui.defaultSettings);
  const [bookData, setBookData] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [outline, setOutline] = useState(null);
  const [generatingPages, setGeneratingPages] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem('living-textbook-dark-mode');
    return saved ? JSON.parse(saved) : false;
  });
  const {
    generateText,
    generateQuip,
    textModel,
    generateImage,
    imageModel,
    saveBookToDB,
  } = useModel();

  const generationWorkerRef = useRef(null);
  const pendingGenerationsRef = useRef(new Set());
  const handleModelRequestRef = useRef(null);

  /**
   * Persist dark mode preference
   */
  useEffect(() => {
    localStorage.setItem('living-textbook-dark-mode', JSON.stringify(darkMode));
    document.documentElement.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  /**
   * Toggle dark mode
   */
  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => !prev);
  }, []);

  /**
   * Handle image regeneration updates from BookRenderer
   */
  useEffect(() => {
    const handleImageUpdate = (event) => {
      const { currentPage, newImage } = event.detail;
      
      setBookData(prev => {
        if (!prev) return prev;
        const newPages = [...(prev.pages || [])];
        if (newPages[currentPage]) {
          newPages[currentPage] = {
            ...newPages[currentPage],
            image: newImage,
          };
        }
        return { ...prev, pages: newPages };
      });
    };

    window.addEventListener('book-image-updated', handleImageUpdate);
    return () => {
      window.removeEventListener('book-image-updated', handleImageUpdate);
    };
  }, []);

  /**
   * Handle model operation requests from worker
   */
  const handleModelRequest = useCallback(async (requestType, payload) => {
    if (!generationWorkerRef.current) return;

    let result;

    try {
      switch (requestType) {
        case 'GENERATE_PROMPT': {
          const { textPrompt, imagePrompt } = generatePrompt(
            payload.subject,
            payload.settings,
            payload.pageNum,
            payload.totalPages,
            payload.previousPageContent
          );
          result = { textPrompt, imagePrompt };
          break;
        }

        case 'GENERATE_TEXT': {
          // Pass complexity for dynamic model selection
          result = await generateText(payload.prompt, {
            complexity: payload.settings?.complexity,
          });
          break;
        }

        case 'GENERATE_IMAGE': {
          // Handle both string prompts and structured prompts with negative
          const promptData = typeof payload.prompt === 'string' 
            ? payload.prompt 
            : payload.prompt.positive;
          const negativePrompt = typeof payload.prompt === 'object' 
            ? payload.prompt.negative 
            : undefined;
          
          result = await generateImage(promptData, { negativePrompt });
          break;
        }

        case 'GENERATE_QUIP_PROMPT': {
          const quipPrompt = generateQuipPrompt(payload.content, payload.subject);
          result = { quipPrompt };
          break;
        }

        case 'GENERATE_QUIP': {
          result = await generateQuip(payload.prompt);
          break;
        }

        default:
          console.warn('Unknown model request type:', requestType);
          return;
      }

      // Send result back to worker
      generationWorkerRef.current.postMessage({
        type: 'MODEL_RESPONSE',
        requestType,
        result,
      });
    } catch (err) {
      console.error(`Model request ${requestType} failed:`, err);
      generationWorkerRef.current.postMessage({
        type: 'MODEL_RESPONSE',
        requestType,
        result: null,
        error: err.message,
      });
    }
  }, [generateText, generateImage, generateQuip]);

  // Store handleModelRequest in ref for use in useEffect
  useEffect(() => {
    handleModelRequestRef.current = handleModelRequest;
  }, [handleModelRequest]);

  /**
   * Initialize the generation worker
   */
  useEffect(() => {
    // Create worker from bundled file
    generationWorkerRef.current = new Worker(
      new URL('./workers/GenerationWorker.js', import.meta.url),
      { type: 'module' }
    );

    // Handle worker messages
    generationWorkerRef.current.onmessage = (event) => {
      const { type, pageNum, pageData, error, requestType, payload } = event.data;

      switch (type) {
        case 'PAGE_START': {
          setGeneratingPages(prev => [...prev, pageNum]);
          break;
        }

        case 'PAGE_COMPLETE': {
          setBookData(prev => {
            const newPages = [...(prev?.pages || [])];
            newPages[pageNum] = pageData;
            return { ...prev, pages: newPages };
          });
          setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          break;
        }

        case 'PAGE_ERROR': {
          console.error(`Worker: Page ${pageNum} error:`, error);
          setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          break;
        }

        case 'QUEUE_COMPLETE':
        case 'GENERATION_CANCELLED':
          pendingGenerationsRef.current.clear();
          break;

        // Handle model operation requests from worker
        case 'MODEL_REQUEST': {
          handleModelRequestRef.current?.(requestType, payload);
          break;
        }

        default:
          break;
      }
    };

    generationWorkerRef.current.onerror = (err) => {
      console.error('Worker error:', err);
      pendingGenerationsRef.current.clear();
    };

    return () => {
      // Cleanup worker on unmount
      if (generationWorkerRef.current) {
        generationWorkerRef.current.terminate();
        generationWorkerRef.current = null;
      }
    };
  }, []);

  /**
   * Parse outline from LLM response
   */
  const parseOutline = useCallback((response) => {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\[.*\]/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length === NUM_PAGES) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to parse outline, using fallback:', err);
    }

    // Fallback outline
    return Array.from({ length: NUM_PAGES }, (_, i) => ({
      title: `Page ${i + 1}`,
      focus: `Continue explaining the topic`
    }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!settings.subject || !generationWorkerRef.current) return;

    // Reset state
    setBookData(null);
    setOutline(null);
    setCurrentPage(0);
    pendingGenerationsRef.current.clear();

    try {
      // Step 1: Generate outline (still on main thread for UI feedback)
      const outlinePrompt = generateOutlinePrompt(settings.subject, settings, NUM_PAGES);
      const outlineResponse = await generateText(outlinePrompt);
      const parsedOutline = parseOutline(outlineResponse);
      setOutline(parsedOutline);

      // Step 2: Initialize book data structure
      setBookData({
        subject: settings.subject,
        pages: Array(NUM_PAGES).fill(null),
        settings: { ...settings }
      });

      // Step 3: Send generation request to worker
      generationWorkerRef.current.postMessage({
        type: 'START_GENERATION',
        payload: {
          settings,
          outline: parsedOutline,
          numPages: NUM_PAGES,
        },
      });

      // Step 4: Worker processes first page immediately, then resumes after delay
      setTimeout(() => {
        if (generationWorkerRef.current) {
          generationWorkerRef.current.postMessage({
            type: 'RESUME_GENERATION',
          });
        }
      }, 500);

    } catch (err) {
      console.error('Generation failed:', err);
      setBookData(null);
    }
  }, [settings, generateText, parseOutline]);

  const handlePageChange = useCallback((newPage) => {
    if (newPage >= 0 && newPage < NUM_PAGES) {
      setCurrentPage(newPage);
    }
  }, []);

  const handleSaveBook = useCallback(async () => {
    if (!bookData || !bookData.subject) {
      alert('No book to save');
      return;
    }

    try {
      const bookId = await saveBookToDB(bookData);
      if (bookId) {
        alert('Book saved to library!');
      } else {
        throw new Error('Failed to save book');
      }
    } catch (err) {
      console.error('Failed to save book:', err);
      alert('Failed to save book');
    }
  }, [bookData, saveBookToDB]);

  const handleLoadBook = useCallback((book) => {
    // Load the book data into the current view
    setBookData(book);
    setOutline(book.pages?.map((page, idx) => ({
      title: page?.title || `Page ${idx + 1}`,
      focus: 'Loaded from saved book',
    })) || []);
    setCurrentPage(0);
  }, []);

  const overallStatus = textModel.loading
    ? textModel.status
    : imageModel.loading
      ? imageModel.status
      : textModel.status;

  const currentPageData = bookData?.pages?.[currentPage];
  const isLoadingPage = generatingPages.includes(currentPage);

  return (
    <div className="app-container">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="logo">📖 Living Textbook</div>
        <div className="header-right">
          <button
            className="header-btn theme-btn"
            onClick={toggleDarkMode}
            disabled={!bookData?.subject}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle dark mode"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button
            className="header-btn"
            onClick={handleSaveBook}
            disabled={!bookData?.subject}
            title="Save Book to Library"
          >
            💾 Save
          </button>
          <button
            className="header-btn"
            onClick={() => setLibraryOpen(true)}
            title="Open Library"
          >
            📚 Library
          </button>
          <div className="status-badge">{overallStatus}</div>
        </div>
      </header>

      <main className="app-main" id="main-content" tabIndex={-1}>
        <aside className="sidebar">
          <ModelStatusDashboard />
        </aside>

        <section className="content-area">
          <ControlPanel
            settings={settings}
            setSettings={setSettings}
            onGenerate={handleGenerate}
            loading={textModel.loading || imageModel.loading}
          />

          <ErrorBoundary>
            <BookRenderer
              bookData={currentPageData ? { ...currentPageData, subject: bookData.subject } : null}
              loading={isLoadingPage}
              currentPage={currentPage}
              totalPages={NUM_PAGES}
              onPageChange={handlePageChange}
              hasOutline={outline !== null}
              generateImage={generateImage}
            />
          </ErrorBoundary>
        </section>
      </main>

      <Narrator
        status={overallStatus}
        progress={textModel.progress || imageModel.progress}
        quip={currentPageData?.quip}
        hasContent={!!currentPageData?.content}
      />

      <BookLibrary
        isOpen={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onLoadBook={handleLoadBook}
      />
    </div>
  );
}

/**
 * App component wrapped with ModelProvider
 */
function App() {
  return (
    <ModelProvider>
      <AppContent />
    </ModelProvider>
  );
}

export default App;
