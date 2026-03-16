import React from 'react';

const Narrator = ({ status, progress }) => {
  const getMessage = () => {
    if (status.includes('Loading')) return `I'm just gathering my thoughts! (${progress}%)`;
    if (status.includes('Generating Content')) return "Writing the best explanation ever...";
    if (status.includes('Generating Image')) return "Painting a picture for you!";
    if (status === 'Model Ready') return "I'm ready to learn something new! What's on your mind?";
    if (status === 'Generation Complete') return "Wow! That was fascinating. Let's look at the book!";
    return "Hi! I'm Logic the Lemur. Let's make a book together!";
  };

  return (
    <div className="narrator">
      <div className="speech-bubble">
        {getMessage()}
      </div>
      <div className="character">
        🐒
      </div>
      <style>{`
        .narrator {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          display: flex;
          align-items: flex-end;
          gap: 1rem;
          z-index: 1000;
        }
        .speech-bubble {
          background: white;
          padding: 1rem 1.5rem;
          border-radius: 1.5rem;
          border-bottom-right-radius: 0.2rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          max-width: 250px;
          border: 2px solid #3b82f6;
          font-weight: 500;
          color: #1e293b;
          position: relative;
        }
        .character {
          font-size: 4rem;
          filter: drop-shadow(0 10px 8px rgba(0, 0, 0, 0.1));
          user-select: none;
        }
      `}</style>
    </div>
  );
};

export default Narrator;
