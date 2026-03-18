/**
 * Tests for Error Handling Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  createAppError,
  toAppError,
  isAppError,
  classifyError,
  isRetryableError,
  calculateRetryDelay,
  withRetry,
  formatError,
  isCancellation,
  DEFAULT_RETRY_CONFIG,
} from '../utils/errors';

describe('Error Utilities', () => {
  describe('createAppError', () => {
    it('should create an AppError with default values', () => {
      const error = createAppError('Test error');

      expect(error.type).toBe('UNKNOWN');
      expect(error.message).toBe('Test error');
      expect(error.retryable).toBe(true);
    });

    it('should create an AppError with custom type', () => {
      const error = createAppError('Network failed', 'NETWORK');

      expect(error.type).toBe('NETWORK');
      expect(error.message).toBe('Network failed');
    });

    it('should include cause and code when provided', () => {
      const cause = new Error('Original error');
      const error = createAppError('Wrapped error', 'MODEL', {
        retryable: false,
        cause,
        code: 'ERR_MODEL_LOAD',
      });

      expect(error.type).toBe('MODEL');
      expect(error.retryable).toBe(false);
      expect(error.cause).toBe(cause);
      expect(error.code).toBe('ERR_MODEL_LOAD');
    });
  });

  describe('toAppError', () => {
    it('should convert string to AppError', () => {
      const error = toAppError('Something went wrong');

      expect(error.type).toBe('UNKNOWN');
      expect(error.message).toBe('Something went wrong');
      expect(error.retryable).toBe(false);
    });

    it('should convert Error to AppError', () => {
      const originalError = new Error('Network timeout');
      const error = toAppError(originalError);

      expect(error.type).toBe('NETWORK');
      expect(error.message).toBe('Network timeout');
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(originalError);
    });

    it('should add context to error message', () => {
      const originalError = new Error('Failed');
      const error = toAppError(originalError, 'Image generation');

      expect(error.message).toBe('Image generation: Failed');
    });

    it('should pass through existing AppError', () => {
      const appError = createAppError('Already an AppError', 'GENERATION');
      const result = toAppError(appError);

      expect(result).toBe(appError);
    });

    it('should handle non-Error objects', () => {
      const error = toAppError({ code: 500, message: 'Server error' });

      expect(error.type).toBe('UNKNOWN');
      expect(error.retryable).toBe(false);
    });
  });

  describe('isAppError', () => {
    it('should identify AppError objects', () => {
      const error = createAppError('Test', 'MODEL');
      expect(isAppError(error)).toBe(true);
    });

    it('should reject plain objects', () => {
      expect(isAppError({ message: 'test' })).toBe(false);
      expect(isAppError({ type: 'MODEL' })).toBe(false);
    });

    it('should reject primitives', () => {
      expect(isAppError('string')).toBe(false);
      expect(isAppError(123)).toBe(false);
      expect(isAppError(null)).toBe(false);
    });
  });

  describe('classifyError', () => {
    it('should classify network errors', () => {
      expect(classifyError(new Error('Network error'))).toBe('NETWORK');
      expect(classifyError(new Error('Fetch failed'))).toBe('NETWORK');
      expect(classifyError(new Error('Connection timeout'))).toBe('NETWORK');

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      expect(classifyError(abortError)).toBe('NETWORK');
    });

    it('should classify storage errors', () => {
      expect(classifyError(new Error('Storage quota exceeded'))).toBe('STORAGE');
      expect(classifyError(new Error('IndexedDB failed'))).toBe('STORAGE');
      expect(classifyError(new Error('Disk full'))).toBe('STORAGE');
    });

    it('should classify model errors', () => {
      expect(classifyError(new Error('Model load failed'))).toBe('MODEL');
      expect(classifyError(new Error('WebGPU not supported'))).toBe('MODEL');
      expect(classifyError(new Error('GPU device lost'))).toBe('MODEL');
      expect(classifyError(new Error('Tokenizer error'))).toBe('MODEL');
    });

    it('should classify generation errors', () => {
      expect(classifyError(new Error('Generation cancelled'))).toBe('GENERATION');
      expect(classifyError(new Error('Prompt too long'))).toBe('GENERATION');
    });

    it('should default to UNKNOWN for unclassified errors', () => {
      expect(classifyError(new Error('Random error'))).toBe('UNKNOWN');
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable errors', () => {
      expect(isRetryableError(new Error('Network error'))).toBe(true);
      expect(isRetryableError(new Error('Connection timeout'))).toBe(true);
      expect(isRetryableError(new Error('GPU device lost'))).toBe(true);
      expect(isRetryableError(new Error('Out of memory'))).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      expect(isRetryableError(new Error('Generation cancelled'))).toBe(false);
      expect(isRetryableError(new Error('Request aborted'))).toBe(false);
      expect(isRetryableError(new Error('Invalid model ID'))).toBe(false);
      expect(isRetryableError(new Error('Unsupported operation'))).toBe(false);
      expect(isRetryableError(new Error('Insufficient storage'))).toBe(false);
    });

    it('should retry unknown errors by default', () => {
      expect(isRetryableError(new Error('Unknown thing happened'))).toBe(true);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const config = {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
      };

      // Attempt 0: 100ms base
      const delay0 = calculateRetryDelay(0, config);
      expect(delay0).toBeGreaterThanOrEqual(80); // 100 - 20% jitter
      expect(delay0).toBeLessThanOrEqual(120); // 100 + 20% jitter

      // Attempt 1: 200ms base
      const delay1 = calculateRetryDelay(1, config);
      expect(delay1).toBeGreaterThanOrEqual(160);
      expect(delay1).toBeLessThanOrEqual(240);

      // Attempt 2: 400ms base
      const delay2 = calculateRetryDelay(2, config);
      expect(delay2).toBeGreaterThanOrEqual(320);
      expect(delay2).toBeLessThanOrEqual(480);
    });

    it('should cap delay at maxDelayMs', () => {
      const config = {
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 500,
        backoffMultiplier: 2,
      };

      // Attempt 4 would be 1600ms without cap
      const delay = calculateRetryDelay(4, config);
      expect(delay).toBeLessThanOrEqual(600); // 500 + 20% jitter
    });

    it('should use default config when not provided', () => {
      const delay = calculateRetryDelay(0);
      expect(delay).toBeGreaterThan(0);
    });
  });

  describe('withRetry', () => {
    it('should return successful result on first try', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(fn, { ...DEFAULT_RETRY_CONFIG, maxRetries: 2 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        withRetry(fn, { ...DEFAULT_RETRY_CONFIG, maxRetries: 2 })
      ).rejects.toThrow('Always fails');

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Generation cancelled');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn)).rejects.toThrow('Generation cancelled');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValueOnce('success');
      const onRetry = vi.fn();

      await withRetry(fn, DEFAULT_RETRY_CONFIG, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });
  });

  describe('formatError', () => {
    it('should format error with type prefix', () => {
      const error = createAppError('Something broke', 'NETWORK');
      expect(formatError(error)).toBe('[NETWORK] Something broke');
    });

    it('should format unknown errors', () => {
      const error = createAppError('Mystery error', 'UNKNOWN');
      expect(formatError(error)).toBe('[UNKNOWN] Mystery error');
    });
  });

  describe('isCancellation', () => {
    it('should identify cancellation errors', () => {
      expect(isCancellation(new Error('Generation cancelled'))).toBe(true);
      expect(isCancellation(new Error('Request aborted'))).toBe(true);

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      expect(isCancellation(abortError)).toBe(true);
    });

    it('should reject non-cancellation errors', () => {
      expect(isCancellation(new Error('Network error'))).toBe(false);
      expect(isCancellation(new Error('Model load failed'))).toBe(false);
    });

    it('should handle non-Error values', () => {
      expect(isCancellation('string')).toBe(false);
      expect(isCancellation(null)).toBe(false);
      expect(isCancellation(123)).toBe(false);
    });
  });
});
