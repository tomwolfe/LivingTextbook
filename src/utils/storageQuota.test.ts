/**
 * Unit tests for storageQuota utility
 * Tests storage quota calculations, availability checks, and formatting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatBytes,
  getStorageQuota,
  checkStorageAvailability,
  assertStorageAvailability,
  getStorageStatus,
  MODEL_SIZES,
  STORAGE_REQUIREMENTS,
  type StorageRequirement,
} from './storageQuota';

describe('storageQuota', () => {
  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes correctly', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should format fractional values', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });

    it('should round to 2 decimal places', () => {
      expect(formatBytes(1234)).toBe('1.21 KB');
    });
  });

  describe('MODEL_SIZES', () => {
    it('should have correct model size constants', () => {
      expect(MODEL_SIZES.FAST_TEXT_MODEL).toBe(300 * 1024 * 1024);
      expect(MODEL_SIZES.QUALITY_TEXT_MODEL).toBe(800 * 1024 * 1024);
      expect(MODEL_SIZES.IMAGE_MODEL).toBe(400 * 1024 * 1024);
      expect(MODEL_SIZES.ALL_MODELS).toBe(1.5 * 1024 * 1024 * 1024);
    });
  });

  describe('STORAGE_REQUIREMENTS', () => {
    it('should map requirements to correct sizes', () => {
      expect(STORAGE_REQUIREMENTS.fast).toBe(MODEL_SIZES.FAST_TEXT_MODEL);
      expect(STORAGE_REQUIREMENTS.quality).toBe(MODEL_SIZES.QUALITY_TEXT_MODEL);
      expect(STORAGE_REQUIREMENTS.image).toBe(MODEL_SIZES.IMAGE_MODEL);
      expect(STORAGE_REQUIREMENTS.all).toBe(MODEL_SIZES.ALL_MODELS);
    });
  });

  describe('getStorageQuota', () => {
    beforeEach(() => {
      // Mock navigator.storage.estimate
      Object.defineProperty(global.navigator, 'storage', {
        value: {
          estimate: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return storage quota information', async () => {
      const mockEstimate = {
        usage: 500 * 1024 * 1024, // 500 MB
        quota: 2 * 1024 * 1024 * 1024, // 2 GB
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await getStorageQuota();

      expect(result.usage).toBe(500 * 1024 * 1024);
      expect(result.quota).toBe(2 * 1024 * 1024 * 1024);
      expect(result.available).toBeGreaterThanOrEqual(1.5 * 1024 * 1024 * 1024 - 1024 * 1024); // Allow small margin
      expect(result.percentUsed).toBeGreaterThanOrEqual(24);
      expect(result.percentUsed).toBeLessThanOrEqual(26);
    });

    it('should handle missing storage API', async () => {
      const originalStorage = global.navigator.storage;
      Object.defineProperty(global.navigator, 'storage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = await getStorageQuota();

      expect(result.usage).toBe(0);
      expect(result.quota).toBe(0);
      expect(result.usageFormatted).toBe('Unknown');

      // Restore
      Object.defineProperty(global.navigator, 'storage', {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('should handle storage API errors', async () => {
      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Storage error'));

      const result = await getStorageQuota();

      expect(result.usage).toBe(0);
      expect(result.quota).toBe(0);
      expect(result.usageFormatted).toBe('Error');
    });
  });

  describe('checkStorageAvailability', () => {
    beforeEach(() => {
      Object.defineProperty(global.navigator, 'storage', {
        value: {
          estimate: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true when enough space available', async () => {
      const mockEstimate = {
        usage: 100 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await checkStorageAvailability('fast');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.canDownload).toBe(true);
      }
    });

    it('should return false when insufficient space', async () => {
      const mockEstimate = {
        usage: 1.9 * 1024 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await checkStorageAvailability('all');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.canDownload).toBe(false);
      }
    });

    it('should include safety margin in calculation', async () => {
      const mockEstimate = {
        usage: 100 * 1024 * 1024,
        quota: 500 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      // Available: 400MB, Required: 300MB + 100MB margin = 400MB (should pass)
      const resultWithMargin = await checkStorageAvailability('fast', 100 * 1024 * 1024);
      
      // Available: 400MB, Required: 300MB + 200MB margin = 500MB (should fail)
      const resultWithLargerMargin = await checkStorageAvailability('fast', 200 * 1024 * 1024);

      if (resultWithMargin.success) {
        expect(resultWithMargin.data.canDownload).toBe(true);
      }
      if (resultWithLargerMargin.success) {
        expect(resultWithLargerMargin.data.canDownload).toBe(false);
      }
    });
  });

  describe('assertStorageAvailability', () => {
    beforeEach(() => {
      Object.defineProperty(global.navigator, 'storage', {
        value: {
          estimate: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should not throw when enough space available', async () => {
      const mockEstimate = {
        usage: 100 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      await expect(assertStorageAvailability('fast')).resolves.toBeUndefined();
    });

    it('should throw when insufficient space', async () => {
      const mockEstimate = {
        usage: 1.9 * 1024 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      await expect(assertStorageAvailability('all'))
        .rejects
        .toThrow('Insufficient storage');
    });
  });

  describe('getStorageStatus', () => {
    beforeEach(() => {
      Object.defineProperty(global.navigator, 'storage', {
        value: {
          estimate: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return ok status when plenty of space', async () => {
      const mockEstimate = {
        usage: 100 * 1024 * 1024,
        quota: 10 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await getStorageStatus();

      expect(result.status).toBe('ok');
      expect(result.message).toContain('Plenty of space');
    });

    it('should return warning status when limited space', async () => {
      // Available space is more than models but less than 500MB buffer
      const mockEstimate = {
        usage: 1.2 * 1024 * 1024 * 1024,
        quota: 3 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await getStorageStatus();

      expect(result.status).toBe('warning');
      expect(result.message).toContain('Limited space');
    });

    it('should return critical status when not enough for models', async () => {
      const mockEstimate = {
        usage: 2.5 * 1024 * 1024 * 1024,
        quota: 3 * 1024 * 1024 * 1024,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await getStorageStatus();

      expect(result.status).toBe('critical');
      expect(result.message).toContain('Low storage');
    });

    it('should return error status when quota is zero', async () => {
      const mockEstimate = {
        usage: 0,
        quota: 0,
      };

      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue(mockEstimate);

      const result = await getStorageStatus();

      expect(result.status).toBe('error');
    });

    it('should return error status when storage API fails', async () => {
      (global.navigator.storage.estimate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      const result = await getStorageStatus();

      expect(result.status).toBe('error');
      expect(result.message).toBe('Storage information unavailable');
    });
  });

  describe('StorageRequirement type', () => {
    it('should accept valid storage requirements', () => {
      const requirements: StorageRequirement[] = ['fast', 'quality', 'image', 'all'];
      
      requirements.forEach(req => {
        expect(STORAGE_REQUIREMENTS[req]).toBeDefined();
      });
    });
  });
});
