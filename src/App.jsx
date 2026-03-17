import React, { useState, useCallback, useRef } from 'react';
import { ModelProvider, useModel } from './contexts/ModelContext';
import ControlPanel from './components/ControlPanel';
import BookRenderer from './components/BookRenderer';
import Narrator from './components/Narrator';
import ModelStatusDashboard from './components/ModelStatusDashboard';
import ErrorBoundary from './components/ErrorBoundary';
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
  const {
    generateText,
    generateQuip,
    textModel,
    generateImage,
    imageModel,
  } = useModel();

  const generationQueueRef = useRef([]);
  const isGeneratingRef = useRef(false);

  /**
   * Generate a single page with text, image, and quip
   */
  const generatePage = useCallback(async (pageNum, pageOutline, currentSettings) => {
    const { textPrompt, imagePrompt } = generatePrompt(
      currentSettings.subject,
      currentSettings,
      pageNum + 1,
      NUM_PAGES
    );

    // Add page-specific context from outline
    const enhancedTextPrompt = `${textPrompt}\n\nFocus on: ${pageOutline.focus}`;

    const [content, imageResult] = await Promise.all([
      generateText(enhancedTextPrompt),
      generateImage(imagePrompt)
    ]);

    // Generate quip after content is ready
    let quip = null;
    if (content) {
      quip = await generateQuip(generateQuipPrompt(content, currentSettings.subject), currentSettings.subject);
    }

    return {
      title: pageOutline.title,
      content: content || 'Content generation failed.',
      image: imageResult,
      quip: quip,
      settings: { ...currentSettings }
    };
  }, [generateText, generateImage, generateQuip]);

  /**
   * Process the generation queue lazily
   */
  const processGenerationQueue = useCallback(async () => {
    if (isGeneratingRef.current || generationQueueRef.current.length === 0) return;

    isGeneratingRef.current = true;

    while (generationQueueRef.current.length > 0) {
      const { pageNum, pageOutline } = generationQueueRef.current.shift();

      setGeneratingPages(prev => [...prev, pageNum]);

      try {
        const pageData = await generatePage(pageNum, pageOutline, settings);

        setBookData(prev => {
          const newPages = [...(prev?.pages || [])];
          newPages[pageNum] = pageData;
          return { ...prev, pages: newPages };
        });
      } catch (err) {
        console.error(`Failed to generate page ${pageNum}:`, err);
      }

      setGeneratingPages(prev => prev.filter(p => p !== pageNum));
    }

    isGeneratingRef.current = false;
  }, [generatePage, settings]);

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
    if (!settings.subject) return;

    // Reset state
    setBookData(null);
    setOutline(null);
    setCurrentPage(0);
    generationQueueRef.current = [];

    try {
      // Step 1: Generate outline
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

      // Step 3: Queue all pages for generation
      generationQueueRef.current = parsedOutline.map((pageOutline, idx) => ({
        pageNum: idx,
        pageOutline
      }));

      // Step 4: Generate first page immediately
      await processGenerationQueue();

      // Step 5: Lazy load remaining pages in background
      setTimeout(() => {
        processGenerationQueue();
      }, 500);

    } catch (err) {
      console.error('Generation failed:', err);
      setBookData(null);
    }
  }, [settings, generateText, parseOutline, processGenerationQueue]);

  const handlePageChange = useCallback((newPage) => {
    if (newPage >= 0 && newPage < NUM_PAGES) {
      setCurrentPage(newPage);
    }
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
      <header className="app-header">
        <div className="logo">📖 Living Textbook</div>
        <div className="header-right">
          <div className="status-badge">{overallStatus}</div>
        </div>
      </header>

      <main className="app-main">
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
