import React from 'react';
import './Narrator.css';

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
    </div>
  );
};

export default Narrator;
