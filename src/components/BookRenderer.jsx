import React, { useState } from 'react';
import jsPDF from 'jspdf';

const BookRenderer = ({ bookData, loading }) => {
  const [currentPage, setCurrentPage] = useState(0);

  if (!bookData && !loading) {
    return (
      <div className="book-empty">
        <h2>Your book will appear here</h2>
        <p>Enter a subject and click "Generate" to start your learning journey.</p>
        <style>{`
          .book-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border: 4px dashed #cbd5e1;
            border-radius: 2rem;
            color: #94a3b8;
            padding: 4rem;
            text-align: center;
          }
        `}</style>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="book-loading">
        <div className="spinner"></div>
        <p>Consulting the AI library...</p>
        <style>{`
          .book-loading {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #f1f5f9;
            border-radius: 2rem;
            padding: 4rem;
          }
          .spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #e2e8f0;
            border-top: 5px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 1rem;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text(bookData.subject, 20, 30);
    doc.setFontSize(12);
    const splitText = doc.splitTextToSize(bookData.content, 170);
    doc.text(splitText, 20, 50);
    doc.save(`${bookData.subject.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="book-container">
      <div className="book-page">
        <div className="page-image">
          {bookData.image ? (
            <img src={bookData.image} alt={bookData.subject} />
          ) : (
            <div className="image-placeholder">Visualizing...</div>
          )}
        </div>
        <div className="page-content">
          <h1>{bookData.subject}</h1>
          <p>{bookData.content}</p>
        </div>
      </div>
      
      <div className="book-controls">
        <button onClick={exportPDF} className="export-btn">Download PDF</button>
      </div>

      <style>{`
        .book-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          max-width: 800px;
        }
        .book-page {
          background: white;
          border-radius: 1.5rem;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 600px;
          border: 1px solid #e2e8f0;
        }
        .page-image {
          height: 400px;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .page-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .image-placeholder {
          font-style: italic;
          color: #94a3b8;
        }
        .page-content {
          padding: 2.5rem;
        }
        .page-content h1 {
          margin-top: 0;
          color: #1e293b;
          font-size: 2rem;
          margin-bottom: 1rem;
          text-transform: capitalize;
        }
        .page-content p {
          color: #475569;
          line-height: 1.8;
          font-size: 1.125rem;
        }
        .book-controls {
          display: flex;
          justify-content: flex-end;
        }
        .export-btn {
          padding: 0.75rem 1.5rem;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 0.5rem;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default BookRenderer;
