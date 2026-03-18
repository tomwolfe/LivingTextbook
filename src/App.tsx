import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { ModelProvider, useModelActions, useModelState } from './contexts/ModelContext';
import { useBookGeneration } from './hooks/useBookGeneration';
import ControlPanel from './components/ControlPanel';
import Narrator from './components/Narrator';
import ModelStatusDashboard from './components/ModelStatusDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import type { BookSettings, Book, ImageResult } from './types';
import { config } from './config';
import './App.css';

// Lazy load heavy components
const BookRenderer = lazy(() => import('./components/BookRenderer'));
const BookLibrary = lazy(() => import('./components/BookLibrary'));

/**
 * Main app content wrapped in ModelProvider
 */
function AppContent() {
  const [settings, setSettings] = useState<BookSettings>(config.ui.defaultSettings as BookSettings);
  const [currentPage, setCurrentPage] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem('living-textbook-dark-mode');
    return saved ? JSON.parse(saved) : false;
  });

  const {
    generateImage,
    saveBookToDB,
    generateOutline,
    startBookGeneration,
    cancelBookGeneration,
    subscribeToWorkerEvents,
  } = useModelActions();

  const { textModel: textModelState, imageModel: imageModelState } = useModelState();

  // Use the centralized book generation hook
  const {
    bookData,
    outline,
    generatingPages,
    isGenerating,
    startGeneration,
    cancelGeneration,
    updatePageImage,
    clearBook,
  } = useBookGeneration({
    generateOutline,
    startBookGeneration,
    cancelBookGeneration,
    subscribeToWorkerEvents,
  });

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
    setDarkMode((prev: boolean) => !prev);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!settings.subject) return;

    const numPages = settings.numPages || config.ui.defaultNumPages;
    try {
      await startGeneration(settings, numPages);
    } catch (err) {
      console.error('Generation failed:', err);
    }
  }, [settings, startGeneration]);

  const handlePageChange = useCallback((newPage: number) => {
    const numPages = settings.numPages || config.ui.defaultNumPages;
    if (newPage >= 0 && newPage < numPages) {
      setCurrentPage(newPage);
    }
  }, [settings.numPages]);

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

  const handleLoadBook = useCallback((_book: Book) => {
    // Clear any existing book first
    clearBook();
    // Note: The hook manages bookData internally, so loading a saved book
    // would require extending the hook. For now, we just clear the current book.
    // The BookLibrary loads the book directly via a separate mechanism.
    setCurrentPage(0);
  }, [clearBook]);

  const handleCancel = useCallback(async () => {
    await cancelGeneration();
  }, [cancelGeneration]);

  const overallStatus = textModelState.loading
    ? textModelState.status
    : imageModelState.loading
      ? imageModelState.status
      : textModelState.status;

  const numPages = settings.numPages || config.ui.defaultNumPages;
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
            onCancel={handleCancel}
            loading={textModelState.loading || imageModelState.loading || isGenerating}
          />

          <ErrorBoundary>
            <Suspense fallback={<div className="loading-spinner">Loading book renderer...</div>}>
              <BookRenderer
                bookData={currentPageData ? { ...currentPageData, subject: bookData.subject } : null}
                fullBook={bookData}
                loading={isLoadingPage}
                currentPage={currentPage}
                totalPages={numPages}
                onPageChange={handlePageChange}
                hasOutline={outline !== null}
                generateImage={generateImage}
                onImageUpdated={updatePageImage}
              />
            </Suspense>
          </ErrorBoundary>
        </section>
      </main>

      <Narrator
        status={overallStatus}
        progress={textModelState.progress || imageModelState.progress}
        quip={currentPageData?.quip}
        hasContent={!!currentPageData?.content}
      />

      <Suspense fallback={<div className="loading-spinner">Loading library...</div>}>
        <BookLibrary
          isOpen={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onLoadBook={handleLoadBook}
        />
      </Suspense>
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
