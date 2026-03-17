import React from 'react';
import type { NarratorProps } from '../types';
import './Narrator.css';

/**
 * Narrator component - Logic the Lemur character
 */
const Narrator: React.FC<NarratorProps> = ({ status, progress, quip, hasContent }) => {
  const getMessage = () => {
    // Priority 1: Show quip if we have content and a quip
    if (hasContent && quip) {
      return quip;
    }

    // Priority 2: Status-based messages
    if (status.includes('Loading')) return `I'm just gathering my thoughts! (${progress}%)`;
    if (status.includes('Generating Content')) return "Writing the best explanation ever...";
    if (status.includes('Generating Image')) return "Painting a picture for you!";
    if (status.includes('Ready')) return "I'm ready to learn something new! What's on your mind?";
    if (status.includes('Complete')) return "Wow! That was fascinating. Let's look at the book!";

    // Priority 3: Default greeting
    return "Hi! I'm Logic the Lemur. Let's make a book together!";
  };

  const isShowingQuip = hasContent && quip;
  const message = getMessage();

  return (
    <div className={`narrator ${isShowingQuip ? 'showing-quip' : ''}`} role="complementary" aria-label="Narrator">
      <div
        className={`speech-bubble ${isShowingQuip ? 'quip-bubble' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message}
      </div>
      <div className="character" aria-hidden="true">
        🐒
      </div>
    </div>
  );
};

export default Narrator;
