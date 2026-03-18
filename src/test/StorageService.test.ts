/**
 * Unit Tests for StorageService
 * Tests IndexedDB book persistence and cache management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from '../core/StorageService';
import type { Book, BookSettings, CacheStats } from '../types';
import type { Mock } from 'vitest';

// Mock the imageCache utilities with inline vi.fn() calls
// These are hoisted automatically by vi.mock
vi.mock('../utils/imageCache', () => ({
  saveBook: vi.fn(),
  getBook: vi.fn(),
  getAllBooks: vi.fn(),
  deleteBook: vi.fn(),
  getCacheStats: vi.fn(),
  clearImageCache: vi.fn(),
}));

describe('StorageService', () => {
  let storageService: StorageService;
  let mockSaveBook: Mock;
  let mockGetBook: Mock;
  let mockGetAllBooks: Mock;
  let mockDeleteBook: Mock;
  let mockGetCacheStats: Mock;
  let mockClearImageCache: Mock;

  const mockBookSettings: BookSettings = {
    subject: 'Test Subject',
    tone: 0.5,
    style: 0.5,
    complexity: 0.5,
    level: 'Student',
    numPages: 3,
  };

  const mockBook: Book = {
    id: 'test-book-1',
    subject: 'Test Book',
    pages: [
      { title: 'Page 1', content: 'Content 1' },
      { title: 'Page 2', content: 'Content 2' },
    ],
    settings: mockBookSettings,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get references to the mocked functions after mock is set up
    const imageCache = await import('../utils/imageCache');
    mockSaveBook = imageCache.saveBook as Mock;
    mockGetBook = imageCache.getBook as Mock;
    mockGetAllBooks = imageCache.getAllBooks as Mock;
    mockDeleteBook = imageCache.deleteBook as Mock;
    mockGetCacheStats = imageCache.getCacheStats as Mock;
    mockClearImageCache = imageCache.clearImageCache as Mock;
    
    storageService = new StorageService();
  });

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      const service = new StorageService();
      expect(service).toBeDefined();
    });

    it('should accept custom maxCachedBooks', () => {
      const service = new StorageService({ maxCachedBooks: 100 });
      expect(service).toBeDefined();
    });
  });

  describe('saveBook', () => {
    it('should save a book and return the ID', async () => {
      const mockId = 'generated-book-id-123';
      mockSaveBook.mockResolvedValue(mockId);

      const result = await storageService.saveBook(mockBook);

      expect(mockSaveBook).toHaveBeenCalledWith(mockBook);
      expect(result).toBe(mockId);
    });

    it('should return null on save failure', async () => {
      mockSaveBook.mockRejectedValue(new Error('Storage full'));

      const result = await storageService.saveBook(mockBook);

      expect(result).toBeNull();
    });

    it('should handle book without ID', async () => {
      const bookWithoutId: Book = { ...mockBook, id: undefined };
      const mockId = 'auto-generated-id';
      mockSaveBook.mockResolvedValue(mockId);

      const result = await storageService.saveBook(bookWithoutId);

      expect(result).toBe(mockId);
    });
  });

  describe('getBook', () => {
    it('should retrieve a book by ID', async () => {
      mockGetBook.mockResolvedValue(mockBook);

      const result = await storageService.getBook('test-book-1');

      expect(mockGetBook).toHaveBeenCalledWith('test-book-1');
      expect(result).toEqual(mockBook);
    });

    it('should return null if book not found', async () => {
      mockGetBook.mockResolvedValue(null);

      const result = await storageService.getBook('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return null on retrieval error', async () => {
      mockGetBook.mockRejectedValue(new Error('Read error'));

      const result = await storageService.getBook('test-book-1');

      expect(result).toBeNull();
    });
  });

  describe('getAllSavedBooks', () => {
    it('should return all saved books', async () => {
      const mockBooks: Book[] = [
        { ...mockBook, id: 'book-1', subject: 'Book 1' },
        { ...mockBook, id: 'book-2', subject: 'Book 2' },
      ];
      mockGetAllBooks.mockResolvedValue(mockBooks);

      const result = await storageService.getAllSavedBooks();

      expect(mockGetAllBooks).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].subject).toBe('Book 1');
    });

    it('should return empty array on error', async () => {
      mockGetAllBooks.mockRejectedValue(new Error('Query failed'));

      const result = await storageService.getAllSavedBooks();

      expect(result).toEqual([]);
    });

    it('should return empty array when no books exist', async () => {
      mockGetAllBooks.mockResolvedValue([]);

      const result = await storageService.getAllSavedBooks();

      expect(result).toEqual([]);
    });
  });

  describe('deleteSavedBook', () => {
    it('should delete a book and return true', async () => {
      mockDeleteBook.mockResolvedValue(true);

      const result = await storageService.deleteSavedBook('test-book-1');

      expect(mockDeleteBook).toHaveBeenCalledWith('test-book-1');
      expect(result).toBe(true);
    });

    it('should return false if book not found', async () => {
      mockDeleteBook.mockResolvedValue(false);

      const result = await storageService.deleteSavedBook('non-existent');

      expect(result).toBe(false);
    });

    it('should return false on deletion error', async () => {
      mockDeleteBook.mockRejectedValue(new Error('Delete failed'));

      const result = await storageService.deleteSavedBook('test-book-1');

      expect(result).toBe(false);
    });
  });

  describe('getCacheStatistics', () => {
    it('should return cache statistics', async () => {
      const mockStats: CacheStats = {
        count: 10,
        sizeBytes: 1024 * 1024 * 5, // 5MB
        sizeFormatted: '5 MB',
      };
      mockGetCacheStats.mockResolvedValue(mockStats);

      const result = await storageService.getCacheStatistics();

      expect(result).toEqual(mockStats);
    });

    it('should return default stats on error', async () => {
      mockGetCacheStats.mockRejectedValue(new Error('Stats failed'));

      const result = await storageService.getCacheStatistics();

      expect(result).toEqual({ count: 0, sizeBytes: 0, sizeFormatted: '0 B' });
    });
  });

  describe('clearImageCache', () => {
    it('should clear the image cache', async () => {
      await storageService.clearImageCache();

      expect(mockClearImageCache).toHaveBeenCalled();
    });

    it('should throw on clear failure', async () => {
      mockClearImageCache.mockRejectedValue(new Error('Clear failed'));

      await expect(storageService.clearImageCache()).rejects.toThrow('Clear failed');
    });
  });

  describe('isStorageCritical', () => {
    it('should return false when storage is healthy', async () => {
      const mockStats: CacheStats = {
        count: 5,
        sizeBytes: 1024 * 1024 * 10, // 10MB
        sizeFormatted: '10 MB',
      };
      mockGetCacheStats.mockResolvedValue(mockStats);

      // Mock navigator.storage.estimate if available
      if (typeof navigator !== 'undefined' && navigator.storage) {
        vi.spyOn(navigator.storage, 'estimate').mockResolvedValue({
          quota: 5 * 1024 * 1024 * 1024,
          usage: 0,
        });
      }

      const result = await storageService.isStorageCritical(0.9);

      expect(result).toBe(false);

      // Restore
      if (typeof navigator !== 'undefined' && navigator.storage) {
        vi.spyOn(navigator.storage, 'estimate').mockRestore();
      }
    });

    it('should return false on error (fail-safe)', async () => {
      mockGetCacheStats.mockRejectedValue(new Error('Stats failed'));

      const result = await storageService.isStorageCritical(0.9);

      expect(result).toBe(false);
    });
  });

  describe('cleanupOldBooks', () => {
    it('should not cleanup if under limit', async () => {
      const fewBooks: Book[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockBook,
        id: `book-${i}`,
        subject: `Book ${i}`,
      }));

      mockGetAllBooks.mockResolvedValue(fewBooks);

      await storageService.cleanupOldBooks();

      expect(mockDeleteBook).not.toHaveBeenCalled();
    });

    it('should delete oldest books when over limit', async () => {
      const manyBooks: Book[] = Array.from({ length: 60 }, (_, i) => ({
        ...mockBook,
        id: `book-${i}`,
        subject: `Book ${i}`,
        createdAt: Date.now() - i * 1000,
        updatedAt: Date.now() - i * 1000,
      }));

      mockGetAllBooks.mockResolvedValue(manyBooks);
      mockDeleteBook.mockResolvedValue(true);

      await storageService.cleanupOldBooks();

      // Should delete 10 books (60 - 50 default limit)
      expect(mockDeleteBook).toHaveBeenCalledTimes(10);
    });

    it('should handle books without IDs gracefully', async () => {
      // Create 60 books: even indices have no ID, odd indices have IDs
      // After sorting by date, the oldest 10 will be deleted
      // Of those 10, only 5 will have IDs (indices 1, 3, 5, 7, 9)
      const booksWithoutIds: Book[] = Array.from({ length: 60 }, (_, i) => ({
        ...mockBook,
        id: i % 2 === 0 ? undefined : `book-${i}`,
        createdAt: Date.now() - i * 1000,
        updatedAt: Date.now() - i * 1000,
      }));

      mockGetAllBooks.mockResolvedValue(booksWithoutIds);
      mockDeleteBook.mockResolvedValue(true);

      await storageService.cleanupOldBooks();

      // Should attempt to delete 10 books (60 - 50 limit)
      // But only 5 of those have IDs (the odd indices: 1, 3, 5, 7, 9)
      expect(mockDeleteBook).toHaveBeenCalledTimes(5);
    });

    it('should continue on individual deletion errors', async () => {
      const manyBooks: Book[] = Array.from({ length: 60 }, (_, i) => ({
        ...mockBook,
        id: `book-${i}`,
      }));

      mockGetAllBooks.mockResolvedValue(manyBooks);
      mockDeleteBook.mockRejectedValue(new Error('Delete failed'));

      // Should not throw
      await expect(storageService.cleanupOldBooks()).resolves.not.toThrow();
    });
  });
});
