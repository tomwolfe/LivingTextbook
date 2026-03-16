import React, { useState, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import BookRenderer from './components/BookRenderer';
import Narrator from './components/Narrator';
import { useTextGen } from './hooks/useTextGen';
import { useImageGen } from './hooks/useImageGen';
import { generatePrompt } from './utils/promptEngine';

function App() {
  const [settings, setSettings] = useState({
    subject: '',
    tone: 0.5,
    style: 0.5,
    complexity: 0.5,
    level: 'Student'
  });

  const [bookData, setBookData] = useState(null);
  const { generateText, loading: textLoading, progress, status: textStatus, initGenerator } = useTextGen();
  const { generateImage, loading: imageLoading, status: imageStatus } = useImageGen();

  const handleGenerate = async () => {
    if (!settings.subject) return;

    const { textPrompt, imagePrompt } = generatePrompt(settings.subject, settings);
    
    setBookData(null);
    const content = await generateText(textPrompt);
    const image = await generateImage(imagePrompt);

    setBookData({
      subject: settings.subject,
      content,
      image,
      settings: { ...settings }
    });
  };

  useEffect(() => {
    initGenerator();
  }, []);

  const overallStatus = textLoading ? textStatus : (imageLoading ? imageStatus : textStatus);

  return (
    <div className="app-container">
      <header>
        <div className="logo">📖 Living Textbook</div>
        <div className="status-badge">{overallStatus}</div>
      </header>

      <main>
        <ControlPanel 
          settings={settings} 
          setSettings={setSettings} 
          onGenerate={handleGenerate}
          loading={textLoading || imageLoading}
        />
        
        <BookRenderer 
          bookData={bookData} 
          loading={textLoading || imageLoading}
        />
      </main>

      <Narrator status={overallStatus} progress={progress} />

      <style>{`
        .app-container {
          min-height: 100vh;
          background-color: #f1f5f9;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          padding-bottom: 5rem;
        }
        header {
          background: white;
          padding: 1rem 4rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
          margin-bottom: 3rem;
        }
        .logo {
          font-size: 1.5rem;
          font-weight: 800;
          color: #1e293b;
        }
        .status-badge {
          background: #e2e8f0;
          padding: 0.5rem 1rem;
          border-radius: 2rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: #475569;
        }
        main {
          max-width: 1300px;
          margin: 0 auto;
          display: flex;
          gap: 3rem;
          padding: 0 2rem;
          align-items: flex-start;
        }
        @media (max-width: 1024px) {
          main {
            flex-direction: column;
            align-items: center;
          }
        }
      `}</style>
    </div>
  );
}

export default App;
