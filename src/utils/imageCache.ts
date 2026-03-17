/**
 * IndexedDB Image Cache Utility
 *
 * Provides persistent storage for generated images to avoid redundant
 * GPU work and enable offline access to previously generated content.
 */

import type { Book, ImageCacheMetadata, CacheStats } from '../types';

const DB_NAME = 'living-textbook-cache';
const DB_VERSION = 1;
const IMAGE_STORE_NAME = 'images';
const BOOK_STORE_NAME = 'books';

/**
 * Image cache record structure
 */
interface ImageCacheRecord {
  promptHash: string;
  prompt: string;
  blob: ArrayBuffer;
  mimeType: string;
  createdAt: number;
  metadata: ImageCacheMetadata;
}

/**
 * Book cache record structure
 */
interface BookCacheRecord extends Book {
  id: string;
  createdAt: number;
  version: number;
}

/**
 * Open/create the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB database'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create image store with prompt as key
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        const imageStore = db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'promptHash' });
        imageStore.createIndex('createdAt', 'createdAt', { unique: false });
        imageStore.createIndex('prompt', 'prompt', { unique: false });
      }

      // Create book store for session serialization
      if (!db.objectStoreNames.contains(BOOK_STORE_NAME)) {
        const bookStore = db.createObjectStore(BOOK_STORE_NAME, { keyPath: 'id' });
        bookStore.createIndex('createdAt', 'createdAt', { unique: false });
        bookStore.createIndex('subject', 'subject', { unique: false });
      }
    };
  });
}

/**
 * Generate a hash from a string (simple hash for cache keys)
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Convert Blob to ArrayBuffer
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<ArrayBuffer>}
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Convert ArrayBuffer to Blob
 * @param {ArrayBuffer} buffer - Buffer to convert
 * @param {string} type - MIME type
 * @returns {Blob}
 */
function arrayBufferToBlob(buffer: ArrayBuffer, type = 'image/png'): Blob {
  return new Blob([buffer], { type });
}

/**
 * Cache an image with its prompt
 * @param {string} prompt - Image generation prompt
 * @param {Blob} imageBlob - Generated image blob
 * @param {Object} metadata - Additional metadata (settings, etc.)
 * @returns {Promise<string | null>} Cache key (prompt hash)
 */
export async function cacheImage(prompt: string, imageBlob: Blob, metadata: ImageCacheMetadata = {} as ImageCacheMetadata): Promise<string | null> {
  try {
    const db = await openDB();
    const promptHash = hashString(prompt);

    const imageData: ImageCacheRecord = {
      promptHash,
      prompt,
      blob: await blobToArrayBuffer(imageBlob),
      mimeType: imageBlob.type || 'image/png',
      createdAt: Date.now(),
      metadata,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.put(imageData);

      request.onsuccess = () => {
        resolve(promptHash);
      };
      request.onerror = () => {
        reject(new Error('Failed to cache image'));
      };
    });
  } catch (err) {
    console.warn('Failed to cache image:', err);
    return null;
  }
}

/**
 * Get a cached image by prompt
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<Blob | null>} Cached image blob or null
 */
export async function getCachedImage(prompt: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const promptHash = hashString(prompt);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readonly');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.get(promptHash);

      request.onsuccess = () => {
        const result = request.result as ImageCacheRecord | undefined;
        if (result && result.blob) {
          resolve(arrayBufferToBlob(result.blob, result.mimeType));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => {
        reject(new Error('Failed to get cached image'));
      };
    });
  } catch (err) {
    console.warn('Failed to get cached image:', err);
    return null;
  }
}

/**
 * Check if an image is cached
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<boolean>}
 */
export async function isImageCached(prompt: string): Promise<boolean> {
  try {
    const db = await openDB();
    const promptHash = hashString(prompt);

    return new Promise((resolve) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readonly');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.get(promptHash);

      request.onsuccess = () => {
        resolve(!!request.result);
      };
      request.onerror = () => {
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('Failed to check cache:', err);
    return false;
  }
}

/**
 * Delete a cached image
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<boolean>}
 */
export async function deleteCachedImage(prompt: string): Promise<boolean> {
  try {
    const db = await openDB();
    const promptHash = hashString(prompt);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.delete(promptHash);

      request.onsuccess = () => {
        resolve(true);
      };
      request.onerror = () => {
        reject(new Error('Failed to delete cached image'));
      };
    });
  } catch (err) {
    console.warn('Failed to delete cached image:', err);
    return false;
  }
}

/**
 * Get cache statistics
 * @returns {Promise<CacheStats>} Cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readonly');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        resolve({
          count: countRequest.result,
          sizeBytes: 0,
          sizeFormatted: 'Unknown',
        });
      };
      countRequest.onerror = () => {
        reject(new Error('Failed to get cache stats'));
      };
    });
  } catch (err) {
    console.warn('Failed to get cache stats:', err);
    return { count: 0, sizeBytes: 0, sizeFormatted: 'Unknown' };
  }
}

/**
 * Clear all cached images
 * @returns {Promise<boolean>}
 */
export async function clearImageCache(): Promise<boolean> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IMAGE_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };
      request.onerror = () => {
        reject(new Error('Failed to clear cache'));
      };
    });
  } catch (err) {
    console.warn('Failed to clear cache:', err);
    return false;
  }
}

/**
 * Save a complete book for session serialization
 * @param {Book} bookData - Complete book data
 * @returns {Promise<string | null>} Book ID
 */
export async function saveBook(bookData: Book): Promise<string | null> {
  try {
    const db = await openDB();
    const bookId = `book_${Date.now()}_${hashString(bookData.subject)}`;

    const bookRecord: BookCacheRecord = {
      id: bookId,
      ...bookData,
      createdAt: Date.now(),
      version: 1,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(BOOK_STORE_NAME);
      const request = store.put(bookRecord);

      request.onsuccess = () => {
        resolve(bookId);
      };
      request.onerror = () => {
        reject(new Error('Failed to save book'));
      };
    });
  } catch (err) {
    console.warn('Failed to save book:', err);
    return null;
  }
}

/**
 * Get a saved book by ID
 * @param {string} bookId - Book ID
 * @returns {Promise<Book | null>}
 */
export async function getBook(bookId: string): Promise<Book | null> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE_NAME], 'readonly');
      const store = transaction.objectStore(BOOK_STORE_NAME);
      const request = store.get(bookId);

      request.onsuccess = () => {
        resolve((request.result as Book) || null);
      };
      request.onerror = () => {
        reject(new Error('Failed to get book'));
      };
    });
  } catch (err) {
    console.warn('Failed to get book:', err);
    return null;
  }
}

/**
 * Get all saved books
 * @returns {Promise<Book[]>} List of saved books
 */
export async function getAllBooks(): Promise<Book[]> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE_NAME], 'readonly');
      const store = transaction.objectStore(BOOK_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const books = (request.result as Book[]) || [];
        // Sort by creation date, newest first
        books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(books);
      };
      request.onerror = () => {
        reject(new Error('Failed to get books'));
      };
    });
  } catch (err) {
    console.warn('Failed to get books:', err);
    return [];
  }
}

/**
 * Delete a saved book
 * @param {string} bookId - Book ID
 * @returns {Promise<boolean>}
 */
export async function deleteBook(bookId: string): Promise<boolean> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(BOOK_STORE_NAME);
      const request = store.delete(bookId);

      request.onsuccess = () => {
        resolve(true);
      };
      request.onerror = () => {
        reject(new Error('Failed to delete book'));
      };
    });
  } catch (err) {
    console.warn('Failed to delete book:', err);
    return false;
  }
}

export default {
  cacheImage,
  getCachedImage,
  isImageCached,
  deleteCachedImage,
  getCacheStats,
  clearImageCache,
  saveBook,
  getBook,
  getAllBooks,
  deleteBook,
};
