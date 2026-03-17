import React from 'react';
import { useModel } from '../contexts/ModelContext';
import { Book, Download, Upload, Trash2, Eye, X } from 'lucide-react';
import './BookLibrary.css';

/**
 * BookLibrary - Component for managing saved books
 */
const BookLibrary = ({ isOpen, onClose, onLoadBook }) => {
  const { getSavedBooks, deleteSavedBook, saveBookToDB } = useModel();
  const [books, setBooks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [previewBook, setPreviewBook] = React.useState(null);

  // Load saved books when library opens
  React.useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getSavedBooks().then((savedBooks) => {
        setBooks(savedBooks);
        setLoading(false);
      }).catch((err) => {
        console.error('Failed to load books:', err);
        setLoading(false);
      });
    }
  }, [isOpen, getSavedBooks]);

  const handleDelete = async (bookId, e) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this book?')) {
      await deleteSavedBook(bookId);
      // Refresh books list
      setLoading(true);
      try {
        const savedBooks = await getSavedBooks();
        setBooks(savedBooks);
      } catch (err) {
        console.error('Failed to load books:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleExport = async (book, e) => {
    e.stopPropagation();
    try {
      const jsonString = JSON.stringify(book, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `living-textbook-${book.subject.replace(/[^a-z0-9]/gi, '-')}-${new Date(book.createdAt).toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export book:', err);
      alert('Failed to export book');
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const bookData = JSON.parse(text);

      // Validate book structure
      if (!bookData.subject || !bookData.pages || !Array.isArray(bookData.pages)) {
        throw new Error('Invalid book format');
      }

      // Save to IndexedDB
      const bookId = await saveBookToDB({
        ...bookData,
        createdAt: bookData.createdAt || Date.now(),
        importedAt: Date.now(),
      });

      if (bookId) {
        alert('Book imported successfully!');
        // Refresh books list
        setLoading(true);
        try {
          const savedBooks = await getSavedBooks();
          setBooks(savedBooks);
        } catch (err) {
          console.error('Failed to load books:', err);
        } finally {
          setLoading(false);
        }
      } else {
        throw new Error('Failed to save imported book');
      }
    } catch (err) {
      console.error('Failed to import book:', err);
      alert('Failed to import book. Please check the file format.');
    }

    // Reset file input
    e.target.value = '';
  };

  const handleLoad = (book) => {
    if (onLoadBook) {
      onLoadBook(book);
    }
    if (onClose) {
      onClose();
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="book-library-overlay" onClick={onClose}>
      <div className="book-library" onClick={(e) => e.stopPropagation()}>
        <div className="book-library-header">
          <h2>
            <Book size={20} />
            My Library
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="book-library-actions">
          <label className="import-btn">
            <Upload size={16} />
            <span>Import Book</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <div className="book-library-content">
          {loading ? (
            <div className="library-loading">Loading your library...</div>
          ) : books.length === 0 ? (
            <div className="library-empty">
              <Book size={48} />
              <p>No saved books yet</p>
              <p className="hint">Generate a book and save it to see it here</p>
            </div>
          ) : (
            <div className="book-list">
              {books.map((book) => (
                <div
                  key={book.id}
                  className="book-item"
                  onClick={() => setPreviewBook(book)}
                >
                  <div className="book-item-info">
                    <h3>{book.subject}</h3>
                    <p className="book-meta">
                      {book.pages?.length || 0} pages • {formatDate(book.createdAt)}
                    </p>
                    {book.importedAt && (
                      <p className="book-imported">Imported book</p>
                    )}
                  </div>
                  <div className="book-item-actions">
                    <button
                      className="action-btn view"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewBook(book);
                      }}
                      title="Preview"
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      className="action-btn export"
                      onClick={(e) => handleExport(book, e)}
                      title="Export as JSON"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="action-btn delete"
                      onClick={(e) => handleDelete(book.id, e)}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {previewBook && (
          <div className="book-preview-overlay" onClick={() => setPreviewBook(null)}>
            <div className="book-preview" onClick={(e) => e.stopPropagation()}>
              <div className="book-preview-header">
                <h3>{previewBook.subject}</h3>
                <button className="close-btn" onClick={() => setPreviewBook(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="book-preview-content">
                <div className="preview-meta">
                  <span><strong>Created:</strong> {formatDate(previewBook.createdAt)}</span>
                  <span><strong>Pages:</strong> {previewBook.pages?.length || 0}</span>
                  {previewBook.settings && (
                    <>
                      <span><strong>Level:</strong> {previewBook.settings.level}</span>
                      <span><strong>Tone:</strong> {previewBook.settings.tone}</span>
                    </>
                  )}
                </div>
                <div className="preview-pages">
                  <h4>Pages:</h4>
                  {previewBook.pages?.map((page, idx) => (
                    <div key={idx} className="preview-page">
                      <strong>{idx + 1}. {page?.title || `Page ${idx + 1}`}</strong>
                      <p>{page?.content?.substring(0, 150) || 'No content'}...</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="book-preview-actions">
                <button
                  className="load-btn"
                  onClick={() => handleLoad(previewBook)}
                >
                  Load This Book
                </button>
                <button
                  className="export-btn-secondary"
                  onClick={(e) => handleExport(previewBook, e)}
                >
                  <Download size={16} />
                  Export JSON
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookLibrary;
