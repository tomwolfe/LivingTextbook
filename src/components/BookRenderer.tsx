import React, { useState, useCallback, useEffect } from 'react';
import { usePdfExport } from '../hooks/usePdfExport';
import { ImageOff } from 'lucide-react';
import type { Book, Page, ImageResult, BookRendererProps } from '../types';
import './BookRenderer.css';

/**
 * Extended BookRenderer props with full book reference
 */
interface BookRendererExtendedProps extends BookRendererProps {
  fullBook?: Book | null;
  onImageUpdated?: (pageNum: number, newImage: ImageResult) => void;
}

/**
 * BookRenderer component with enhanced PDF export and page navigation
 */
const BookRenderer: React.FC<BookRendererExtendedProps> = ({
  bookData,
  loading,
  currentPage,
  totalPages,
  onPageChange,
  hasOutline,
  generateImage,
  fullBook,
  onImageUpdated,
}) => {
  const [isFlipping, setIsFlipping] = useState(false);
  const [regeneratingImage, setRegeneratingImage] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Use the usePdfExport hook for PDF generation
  // Note: Pass only fullBook since it has the complete Book structure with pages array
  const { exporting, exportProgress, exportError, exportPDF, cancelExport, resetExport } = usePdfExport({
    bookData: fullBook || null,
  });

  /**
   * Handle page change with animation
   */
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage < 0 || newPage >= totalPages) return;
    setIsFlipping(true);
    setTimeout(() => {
      onPageChange(newPage);
      setIsFlipping(false);
      setImageError(false); // Reset image error on page change
    }, 300);
  }, [onPageChange, totalPages]);

  /**
   * Regenerate image for current page
   */
  const handleRegenerateImage = useCallback(async () => {
    if (!bookData || !generateImage) return;

    setRegeneratingImage(true);
    setImageError(false);

    try {
      // Use the current image prompt or generate a new one based on subject
      const imagePrompt = bookData.imagePrompt || `A depiction of ${bookData.subject}, educational, bright colors, high quality.`;

      const result = await generateImage(imagePrompt, { skipCache: true });

      if (result && result.imageUrl) {
        // Update book data with new image via parent callback
        if (onImageUpdated) {
          onImageUpdated(currentPage, result);
        }
        setImageError(false);
      }
    } catch (err) {
      console.error('Failed to regenerate image:', err);
      alert('Failed to regenerate image. Please try again.');
    } finally {
      setRegeneratingImage(false);
    }
  }, [bookData, generateImage, currentPage, onImageUpdated]);

  /**
   * Handle image load error
   */
  const handleImageError = useCallback(() => {
    console.warn('Image failed to load for page:', currentPage);
    setImageError(true);
  }, [currentPage]);

  /**
   * Keyboard navigation for pages - scoped to the book container
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only handle arrow keys when not in an input field
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (currentPage > 0) {
          handlePageChange(currentPage - 1);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (currentPage < totalPages - 1) {
          handlePageChange(currentPage + 1);
        }
        break;
      case 'Home':
        e.preventDefault();
        if (currentPage !== 0) {
          handlePageChange(0);
        }
        break;
      case 'End':
        e.preventDefault();
        if (currentPage !== totalPages - 1) {
          handlePageChange(totalPages - 1);
        }
        break;
      default:
        break;
    }
  }, [currentPage, totalPages, handlePageChange]);

  // Empty state
  if (!bookData && !loading && !hasOutline) {
    return (
      <div className="book-empty">
        <h2>Your book will appear here</h2>
        <p>Enter a subject and click "Generate" to start your learning journey.</p>
      </div>
    );
  }

  // Loading state (generating outline)
  if (loading && !bookData) {
    return (
      <div className="book-loading">
        <div className="spinner"></div>
        <p>Creating book outline...</p>
      </div>
    );
  }

  // Page loading state
  if (loading && bookData) {
    return (
      <div className="book-loading">
        <div className="spinner"></div>
        <p>Generating page {currentPage + 1} of {totalPages}...</p>
      </div>
    );
  }

  // No book data available
  if (!bookData) {
    return (
      <div className="book-empty">
        <h2>No page selected</h2>
        <p>Select a page from the outline or generate a new book.</p>
      </div>
    );
  }

  // Determine if we should show image fallback
  const showImageFallback = imageError || !bookData.image?.imageUrl;
  const isGeneratingImage = loading;

  return (
    <div
      className="book-container"
      role="region"
      aria-label="Book reader"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`book-page ${isFlipping ? 'flipping' : ''}`}
        role="article"
        aria-label={`Page ${currentPage + 1} of ${totalPages}`}
      >
        <div className="page-header">
          <span className="page-indicator" aria-live="polite">Page {currentPage + 1} of {totalPages}</span>
          {bookData.title && <span className="page-title">{bookData.title}</span>}
        </div>

        <div className="page-image">
          {bookData.image?.imageUrl && !showImageFallback ? (
            <>
              <img
                src={bookData.image.imageUrl}
                alt={`Illustration for ${bookData.subject}`}
                onError={handleImageError}
              />
              <button
                className="regenerate-image-btn"
                onClick={handleRegenerateImage}
                disabled={regeneratingImage}
                aria-label="Regenerate image for this page"
                title="Generate a new image for this page"
              >
                {regeneratingImage ? '🎨 Generating...' : '🔄 New Image'}
              </button>
            </>
          ) : showImageFallback && !isGeneratingImage ? (
            // Graceful fallback when image is missing or failed
            <div className="image-fallback" role="status">
              <ImageOff size={48} className="fallback-icon" />
              <p>Image not available</p>
              <button
                className="retry-image-btn"
                onClick={handleRegenerateImage}
                disabled={regeneratingImage}
              >
                {regeneratingImage ? 'Generating...' : 'Try Again'}
              </button>
            </div>
          ) : (
            <div className="image-placeholder" role="status">Visualizing...</div>
          )}
        </div>
        <div className="page-content">
          <h1>{bookData.subject}</h1>
          <p>{bookData.content}</p>
        </div>
      </div>

      <div className="book-controls" role="navigation" aria-label="Page navigation">
        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 0}
          className="nav-btn prev-btn"
          aria-label="Go to previous page"
        >
          ← Previous
        </button>

        <button
          onClick={exportPDF}
          className="export-btn"
          disabled={exporting || !bookData}
          aria-label="Download complete book as PDF"
          title="Export all pages as a PDF book"
        >
          {exporting ? `📄 Exporting ${exportProgress}%...` : '📕 Download Book PDF'}
        </button>

        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages - 1}
          className="nav-btn next-btn"
          aria-label="Go to next page"
        >
          Next →
        </button>
      </div>

      <div className="page-dots" role="tablist" aria-label="Page selection">
        {Array.from({ length: totalPages }).map((_, idx) => (
          <span
            key={idx}
            className={`dot ${idx === currentPage ? 'active' : ''}`}
            onClick={() => handlePageChange(idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handlePageChange(idx);
              }
            }}
            role="tab"
            aria-selected={idx === currentPage}
            aria-label={`Go to page ${idx + 1}`}
            tabIndex={idx === currentPage ? 0 : -1}
          />
        ))}
      </div>

      {exportError && (
        <div className="export-error">
          <p>PDF export failed: {exportError}</p>
          <button onClick={resetExport}>Dismiss</button>
        </div>
      )}
    </div>
  );
};

export default BookRenderer;
