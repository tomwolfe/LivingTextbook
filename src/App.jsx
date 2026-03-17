import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ModelProvider, useModelActions, useModelState } from './contexts/ModelContext';
import ControlPanel from './components/ControlPanel';
import BookRenderer from './components/BookRenderer';
import Narrator from './components/Narrator';
import ModelStatusDashboard from './components/ModelStatusDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import BookLibrary from './components/BookLibrary';
import { generatePrompt } from './utils/promptEngine';
import { config } from './config';
import './App.css';

const NUM_PAGES = 3;

/**
 * Parse outline from LLM response with robust JSON extraction
 */
function parseOutline(response) {
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
      if (Array.isArray(parsed) && parsed.length === NUM_PAGES) {
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
  return Array.from({ length: NUM_PAGES }, (_, i) => ({
    title: `Page ${i + 1}`,
    focus: `Continue explaining the topic`
  }));
}

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
    generateOutline,
    startBookGeneration,
  } = useModelActions();

  const { textModel: textModelState, imageModel: imageModelState } = useModelState();

  const pendingGenerationsRef = useRef(new Set());

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
      const { currentPage: pageNum, newImage } = event.detail;

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
    };

    window.addEventListener('book-image-updated', handleImageUpdate);
    return () => {
      window.removeEventListener('book-image-updated', handleImageUpdate);
    };
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
          setGeneratingPages(prev => prev.filter(p => p !== pageNum));
          break;
        }

        case 'QUEUE_COMPLETE':
        case 'GENERATION_CANCELLED':
          pendingGenerationsRef.current.clear();
          setGeneratingPages([]);
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

  const handleGenerate = useCallback(async () => {
    if (!settings.subject) return;

    // Reset state
    setBookData(null);
    setOutline(null);
    setCurrentPage(0);
    pendingGenerationsRef.current.clear();

    try {
      // Step 1: Generate outline
      const outlineResponse = await generateOutline(settings.subject, settings, NUM_PAGES);
      const parsedOutline = parseOutline(outlineResponse);
      setOutline(parsedOutline);

      // Step 2: Initialize book data structure
      setBookData({
        subject: settings.subject,
        pages: Array(NUM_PAGES).fill(null),
        settings: { ...settings }
      });

      // Step 3: Start generation in worker
      // The worker will process the queue asynchronously - no need for resume call
      await startBookGeneration(settings, parsedOutline, NUM_PAGES);

    } catch (err) {
      console.error('Generation failed:', err);
      setBookData(null);
    }
  }, [settings, generateOutline, startBookGeneration]);

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

  const overallStatus = textModelState.loading
    ? textModelState.status
    : imageModelState.loading
      ? imageModelState.status
      : textModelState.status;

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
            loading={textModelState.loading || imageModelState.loading}
          />

          <ErrorBoundary>
            <BookRenderer
              bookData={currentPageData ? { ...currentPageData, subject: bookData.subject } : null}
              fullBook={bookData}
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
        progress={textModelState.progress || imageModelState.progress}
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
