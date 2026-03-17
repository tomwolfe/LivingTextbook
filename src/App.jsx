import React, { useState } from 'react';
import { ModelProvider, useModel } from './contexts/ModelContext';
import ControlPanel from './components/ControlPanel';
import BookRenderer from './components/BookRenderer';
import Narrator from './components/Narrator';
import ModelStatusDashboard from './components/ModelStatusDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { generatePrompt } from './utils/promptEngine';
import { config } from './config';
import './App.css';

/**
 * Main app content wrapped in ModelProvider
 */
function AppContent() {
  const [settings, setSettings] = useState(config.ui.defaultSettings);
  const [bookData, setBookData] = useState(null);
  const {
    generateText,
    textModel,
    generateImage,
    imageModel,
  } = useModel();

  const handleGenerate = async () => {
    if (!settings.subject) return;

    const { textPrompt, imagePrompt } = generatePrompt(settings.subject, settings);

    setBookData(null);
    const content = await generateText(textPrompt);
    const imageResult = await generateImage(imagePrompt);

    setBookData({
      subject: settings.subject,
      content,
      image: imageResult,
      settings: { ...settings }
    });
  };

  const overallStatus = textModel.loading
    ? textModel.status
    : imageModel.loading
      ? imageModel.status
      : textModel.status;

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
            loading={textLoading || imageLoading}
          />

          <ErrorBoundary>
            <BookRenderer
              bookData={bookData}
              loading={textModel.loading || imageModel.loading}
            />
          </ErrorBoundary>
        </section>
      </main>

      <Narrator status={overallStatus} progress={progress} />
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
