/**
 * Storage Service
 * Handles book persistence and cache management
 */

import type { Book, CacheStats } from '../types';
import { storageLogger } from '../utils/logger';
import {
  saveBook,
  getBook,
  getAllBooks,
  deleteBook,
  getCacheStats,
  clearImageCache as clearCache,
} from '../utils/imageCache';

export interface StorageServiceConfig {
  maxCachedBooks?: number;
}

/**
 * StorageService handles IndexedDB operations for books and cache
 */
export class StorageService {
  private maxCachedBooks: number;

  constructor(config: StorageServiceConfig = {}) {
    this.maxCachedBooks = config.maxCachedBooks || 50;
  }

  /**
   * Save a book to IndexedDB
   */
  async saveBook(bookData: Book): Promise<string | null> {
    try {
      const bookId = await saveBook(bookData);
      storageLogger.info('Book saved', { bookId, subject: bookData.subject });
      return bookId;
    } catch (error) {
      storageLogger.error('Failed to save book', error as Error);
      return null;
    }
  }

  /**
   * Get a saved book by ID
   */
  async getBook(bookId: string): Promise<Book | null> {
    try {
      const book = await getBook(bookId);
      if (book) {
        storageLogger.debug('Book loaded', { bookId, subject: book.subject });
      }
      return book;
    } catch (error) {
      storageLogger.error('Failed to get book', error as Error);
      return null;
    }
  }

  /**
   * Get all saved books
   */
  async getAllSavedBooks(): Promise<Book[]> {
    try {
      const books = await getAllBooks();
      storageLogger.debug('Loaded all books', { count: books.length });
      return books;
    } catch (error) {
      storageLogger.error('Failed to get all books', error as Error);
      return [];
    }
  }

  /**
   * Delete a saved book
   */
  async deleteSavedBook(bookId: string): Promise<boolean> {
    try {
      const result = await deleteBook(bookId);
      if (result) {
        storageLogger.info('Book deleted', { bookId });
      }
      return result;
    } catch (error) {
      storageLogger.error('Failed to delete book', error as Error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStatistics(): Promise<CacheStats> {
    try {
      const stats = await getCacheStats();
      storageLogger.debug('Cache stats retrieved', { ...stats });
      return stats;
    } catch (error) {
      storageLogger.error('Failed to get cache stats', { error: error as Error });
      return { count: 0, sizeBytes: 0, sizeFormatted: '0 B' };
    }
  }

  /**
   * Clear the image cache
   */
  async clearImageCache(): Promise<void> {
    try {
      await clearCache();
      storageLogger.info('Image cache cleared');
    } catch (error) {
      storageLogger.error('Failed to clear image cache', error as Error);
      throw error;
    }
  }

  /**
   * Check if we're approaching storage limits
   */
  async isStorageCritical(threshold: number = 0.9): Promise<boolean> {
    try {
      const stats = await this.getCacheStatistics();
      // Estimate: assume 1MB per book average
      const estimatedUsage = stats.sizeBytes + (this.maxCachedBooks * 1024 * 1024);
      
      // Use navigator.storage.estimate() if available
      let quota = 5 * 1024 * 1024 * 1024; // Default 5GB
      if (navigator.storage && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        quota = estimate.quota || quota;
      }
      
      const usageRatio = estimatedUsage / quota;
      return usageRatio > threshold;
    } catch (error) {
      storageLogger.warn('Failed to check storage status', { error: error as Error });
      return false;
    }
  }

  /**
   * Clean up old books if we exceed the limit
   */
  async cleanupOldBooks(): Promise<void> {
    try {
      const books = await this.getAllSavedBooks();
      if (books.length <= this.maxCachedBooks) return;

      // Sort by updatedAt and remove oldest
      const sorted = books.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt || 0;
        const bTime = b.updatedAt || b.createdAt || 0;
        return aTime - bTime;
      });

      const toDelete = sorted.slice(0, sorted.length - this.maxCachedBooks);
      for (const book of toDelete) {
        if (book.id) {
          await this.deleteSavedBook(book.id);
        }
      }

      storageLogger.info('Cleaned up old books', { deleted: toDelete.length });
    } catch (error) {
      storageLogger.error('Failed to cleanup old books', error as Error);
    }
  }
}

export default StorageService;
