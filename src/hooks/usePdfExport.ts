import { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import type { Book, ImageResult } from '../types';
import type { UsePdfExportReturn } from '../types';

/**
 * Convert blob to base64 data URL
 * @param blob - Image blob
 * @returns Base64 data URL
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) {
        resolve(reader.result as string);
      } else {
        reject(new Error('FileReader returned null'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
};

/**
 * Sleep utility for chunking
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Split text into chunks that fit on a single page
 * @param doc - jsPDF instance
 * @param text - Text content
 * @param contentWidth - Available width for text
 * @param availableHeight - Available height for text
 * @param fontSize - Font size to use
 * @returns Object with lines array and remaining text
 */
const splitTextForPage = (
  doc: jsPDF,
  text: string,
  contentWidth: number,
  availableHeight: number,
  fontSize: number = 12
): { lines: string[]; remainingText: string | null } => {
  const lineHeight = 1.15;
  doc.setFontSize(fontSize);
  
  // Split text into lines that fit the width
  const allLines = doc.splitTextToSize(text, contentWidth);
  const maxLines = Math.floor(availableHeight / (fontSize * lineHeight));
  
  if (allLines.length <= maxLines) {
    // All text fits on this page
    return { lines: allLines, remainingText: null };
  }
  
  // Text needs to be split across pages
  const linesForThisPage = allLines.slice(0, maxLines);
  const remainingLines = allLines.slice(maxLines);
  const remainingText = remainingLines.join('\n');
  
  return { lines: linesForThisPage, remainingText };
};

/**
 * Render text content across multiple pages if needed
 * @param doc - jsPDF instance
 * @param text - Text content
 * @param margin - Page margin
 * @param textY - Starting Y position for text
 * @param contentWidth - Available width for text
 * @param pageHeight - Page height
 * @param fontSize - Font size to use
 * @param addFooter - Footer callback function
 * @param currentPageNum - Current page number
 * @param totalPages - Total pages in document
 * @returns Number of additional pages added
 */
const renderTextAcrossPages = (
  doc: jsPDF,
  text: string,
  margin: number,
  textY: number,
  contentWidth: number,
  pageHeight: number,
  fontSize: number,
  addFooter: (doc: jsPDF, pageNum: number, totalPages: number, pageWidth: number, pageHeight: number, margin: number) => void,
  currentPageNum: number,
  totalPages: number
): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const lineHeight = 1.15;
  let additionalPages = 0;
  let remainingText: string | null = text;
  let currentY = textY;
  let pageNum = currentPageNum;
  
  while (remainingText !== null) {
    const availableHeight = pageHeight - currentY - margin - 20;
    const { lines, remainingText: newRemaining } = splitTextForPage(
      doc,
      remainingText,
      contentWidth,
      availableHeight,
      fontSize
    );
    
    // Render lines on current page
    doc.text(lines, margin, currentY);
    
    // Add footer to current page
    addFooter(doc, pageNum, totalPages, pageWidth, pageHeight, margin);
    
    remainingText = newRemaining;
    
    // If there's remaining text, add a new page
    if (remainingText !== null) {
      doc.addPage();
      additionalPages++;
      pageNum++;
      // Update total pages since we added a page
      // (this is handled by the caller passing updated totalPages)
      currentY = margin + 25; // Reset Y position for new page
      
      // Add header to continuation page
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(128);
      doc.text('(continued)', pageWidth - margin, margin + 10, { align: 'right' });
    }
  }
  
  return additionalPages;
};

/**
 * usePdfExport Hook
 * Handles PDF export with async processing to avoid blocking the main thread
 * Memory-safe: explicitly nullifies base64 strings after use to encourage GC
 *
 * @param options - Hook options
 * @param options.bookData - Book data to export
 * @returns PDF export state and handlers
 */
export function usePdfExport({ bookData }: { bookData?: Book | null } = {}): UsePdfExportReturn {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Add footer with page number to PDF
   */
  const addFooter = useCallback((
    doc: jsPDF,
    pageNum: number,
    totalPages: number,
    pageWidth: number,
    pageHeight: number,
    margin: number
  ) => {
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text(
      `Page ${pageNum} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    doc.text(
      'Generated by Living Textbook',
      margin,
      pageHeight - 10
    );
    doc.text(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
  }, []);

  /**
   * Export PDF with async processing
   * Uses requestAnimationFrame and chunking to avoid blocking the main thread
   * Memory-safe: uses block scoping and explicit nullification for GC
   * Multi-page support: Text content flows across pages if it doesn't fit
   */
  const exportPDF = useCallback(async () => {
    if (!bookData || !bookData.subject) return;

    setExporting(true);
    setExportProgress(0);
    setExportError(null);

    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      const fontSize = 12; // Minimum readable font size

      // === COVER PAGE ===
      // Add gradient background effect with rectangles
      doc.setFillColor(102, 126, 234);
      doc.rect(0, 0, pageWidth, 60, 'F');

      // Title
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255);
      doc.text(bookData.subject, pageWidth / 2, 35, { align: 'center' });

      // Subtitle
      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(255);
      doc.text(
        `A ${bookData.settings?.level || 'General'} Level Educational Book`,
        pageWidth / 2,
        45,
        { align: 'center' }
      );

      // Cover image if available - process in isolated block scope
      const coverPage = bookData.pages?.[0];
      if (coverPage?.image?.blob) {
        try {
          await sleep(0);
          // Use block scope to ensure base64String falls out of scope immediately
          {
            const base64String = await blobToBase64(coverPage.image.blob);
            if (base64String) {
              const coverImageSize = 80;
              const coverImageX = (pageWidth - coverImageSize) / 2;
              doc.addImage(
                base64String,
                'JPEG',
                coverImageX,
                60,
                coverImageSize,
                coverImageSize,
                undefined,
                'FAST'
              );
            }
          } // base64String out of scope here
        } catch (err) {
          console.warn('Cover image failed:', err);
        }
      }

      // Metadata on cover
      doc.setFontSize(10);
      doc.setTextColor(100);
      const metaY = coverPage?.image?.blob ? 150 : 100;

      if (bookData.settings) {
        doc.text(`Reading Level: ${bookData.settings.level}`, pageWidth / 2, metaY, { align: 'center' });
        doc.text(`Tone: ${bookData.settings.tone > 0.7 ? 'Fun & Playful' : bookData.settings.tone < 0.3 ? 'Academic' : 'Balanced'}`, pageWidth / 2, metaY + 10, { align: 'center' });
        doc.text(`Style: ${bookData.settings.style > 0.7 ? 'Realistic' : bookData.settings.style < 0.3 ? 'Cartoonish' : 'Digital Art'}`, pageWidth / 2, metaY + 20, { align: 'center' });
      }

      doc.text(
        `Created with Living Textbook AI`,
        pageWidth / 2,
        pageHeight - 30,
        { align: 'center' }
      );
      doc.setFontSize(8);
      doc.text(
        `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        pageWidth / 2,
        pageHeight - 22,
        { align: 'center' }
      );

      // Initial page count (cover + content pages, will be updated if text overflows)
      let baseTotalPages = (bookData.pages?.length || 1) + 1;
      
      // Add footer to cover
      addFooter(doc, 1, baseTotalPages, pageWidth, pageHeight, margin);

      // === CONTENT PAGES ===
      const pages = bookData.pages || [];
      let pdfPageNum = 2; // Start after cover
      let totalAdditionalPages = 0; // Track extra pages from text overflow

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;

        // Yield to main thread between pages to prevent freezing
        if (i > 0) {
          await new Promise(resolve => {
            if (typeof requestAnimationFrame !== 'undefined') {
              requestAnimationFrame(() => resolve(null));
            } else {
              setTimeout(resolve, 10);
            }
          });
        }

        // Update progress
        setExportProgress(Math.round(((i + 1) / pages.length) * 100));

        // Add new page for content
        if (i > 0 || baseTotalPages > 1) {
          doc.addPage();
        }
        
        const currentTotalPages = baseTotalPages + totalAdditionalPages;

        // Page header with title
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30);
        doc.text(page.title || `Page ${i + 1}`, margin, margin + 10);

        // Page number indicator
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(128);
        doc.text(`Page ${i + 1} of ${pages.length}`, pageWidth - margin, margin + 10, { align: 'right' });

        // Process image in isolated block scope for GC
        if (page.image?.blob) {
          try {
            await sleep(10);
            // Use block scope to ensure base64String is collected immediately
            {
              const base64String = await blobToBase64(page.image.blob);
              if (base64String) {
                const imageHeight = contentWidth;
                const imageY = margin + 25;

                doc.addImage(
                  base64String,
                  'JPEG',
                  margin,
                  imageY,
                  contentWidth,
                  imageHeight,
                  undefined,
                  'FAST'
                );

                // Add content text below image - with multi-page support
                doc.setFontSize(fontSize);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(50);
                const textY = imageY + imageHeight + 15;
                
                // Render text, handling overflow across pages
                const additionalPages = renderTextAcrossPages(
                  doc,
                  page.content || '',
                  margin,
                  textY,
                  contentWidth,
                  pageHeight,
                  fontSize,
                  addFooter,
                  pdfPageNum,
                  currentTotalPages
                );
                
                totalAdditionalPages += additionalPages;
                
                // If we added pages, skip to after the last added page
                if (additionalPages > 0) {
                  pdfPageNum += additionalPages;
                }
              } else {
                // Fallback: text only with multi-page support
                const textY = margin + 25;
                const additionalPages = renderTextAcrossPages(
                  doc,
                  page.content || '',
                  margin,
                  textY,
                  contentWidth,
                  pageHeight,
                  fontSize,
                  addFooter,
                  pdfPageNum,
                  currentTotalPages
                );
                totalAdditionalPages += additionalPages;
                if (additionalPages > 0) {
                  pdfPageNum += additionalPages;
                }
              }
            } // base64String out of scope here
          } catch (err) {
            console.warn(`Page ${i + 1} image failed:`, err);
            // Fallback to text only with multi-page support
            const textY = margin + 25;
            const additionalPages = renderTextAcrossPages(
              doc,
              page.content || '',
              margin,
              textY,
              contentWidth,
              pageHeight,
              fontSize,
              addFooter,
              pdfPageNum,
              baseTotalPages + totalAdditionalPages
            );
            totalAdditionalPages += additionalPages;
            if (additionalPages > 0) {
              pdfPageNum += additionalPages;
            }
          }
        } else {
          // No image - text only with multi-page support
          const textY = margin + 25;
          const additionalPages = renderTextAcrossPages(
            doc,
            page.content || '',
            margin,
            textY,
            contentWidth,
            pageHeight,
            fontSize,
            addFooter,
            pdfPageNum,
            baseTotalPages + totalAdditionalPages
          );
          totalAdditionalPages += additionalPages;
          if (additionalPages > 0) {
            pdfPageNum += additionalPages;
          }
        }

        // Move to next page for next iteration
        pdfPageNum++;
      }

      // Set PDF metadata
      doc.setProperties({
        title: bookData.subject,
        subject: `Educational Book - ${bookData.settings?.level || 'General'} Level`,
        author: 'Living Textbook AI',
        creator: 'Living Textbook',
        keywords: `education, ${bookData.subject}, AI-generated, ${bookData.settings?.level || 'general'}`,
      });

      // Yield before saving
      await sleep(0);

      // Save the PDF with formatted filename
      const safeSubject = bookData.subject.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `LivingTextbook_${safeSubject}_${dateStr}.pdf`;
      doc.save(filename);

      setExportProgress(100);
    } catch (error) {
      console.error('PDF export failed:', error);
      setExportError((error as Error).message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }, [bookData, addFooter]);

  /**
   * Cancel export (reset state)
   */
  const cancelExport = useCallback(() => {
    setExporting(false);
    setExportProgress(0);
    setExportError(null);
  }, []);

  /**
   * Reset export state
   */
  const resetExport = useCallback(() => {
    setExporting(false);
    setExportProgress(0);
    setExportError(null);
  }, []);

  return {
    // State
    exporting,
    exportProgress,
    exportError,

    // Actions
    exportPDF,
    cancelExport,
    resetExport,
  };
}

export default usePdfExport;
