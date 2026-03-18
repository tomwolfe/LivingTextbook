/**
 * Standardized Error Handling Utilities
 */

import type { AppError, ErrorType, RetryConfig } from '../types';

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Create an AppError from various error sources
 */
export function createAppError(
  message: string,
  type: ErrorType = 'UNKNOWN',
  options?: { retryable?: boolean; cause?: Error; code?: string }
): AppError {
  return {
    type,
    message,
    retryable: options?.retryable ?? true,
    cause: options?.cause,
    code: options?.code,
  };
}

/**
 * Convert an unknown error to AppError
 */
export function toAppError(error: unknown, context?: string): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = context ? `${context}: ${error.message}` : error.message;
    const type = classifyError(error);
    const retryable = isRetryableError(error);

    return createAppError(message, type, { retryable, cause: error });
  }

  // Handle non-Error objects
  const message = typeof error === 'string' ? error : 'An unknown error occurred';
  return createAppError(context ? `${context}: ${message}` : message, 'UNKNOWN', {
    retryable: false,
  });
}

/**
 * Check if a value is an AppError
 */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'message' in value &&
    'retryable' in value
  );
}

/**
 * Classify an Error into an ErrorType
 */
export function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

  // Network-related errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    error.name === 'AbortError'
  ) {
    return 'NETWORK';
  }

  // Storage-related errors
  if (
    message.includes('storage') ||
    message.includes('quota') ||
    message.includes('indexeddb') ||
    message.includes('disk')
  ) {
    return 'STORAGE';
  }

  // Model-related errors
  if (
    message.includes('model') ||
    message.includes('webgpu') ||
    message.includes('gpu') ||
    message.includes('transformer') ||
    message.includes('tokenizer')
  ) {
    return 'MODEL';
  }

  // Generation-related errors
  if (
    message.includes('generation') ||
    message.includes('generate') ||
    message.includes('prompt') ||
    message.includes('cancelled')
  ) {
    return 'GENERATION';
  }

  return 'UNKNOWN';
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Non-retryable errors
  if (
    message.includes('cancelled') ||
    message.includes('aborted') ||
    message.includes('invalid') ||
    message.includes('unsupported') ||
    message.includes('insufficient storage') ||
    message.includes('quota')
  ) {
    return false;
  }

  // Retryable errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('device lost') ||
    message.includes('out of memory')
  ) {
    return true;
  }

  // Default: retry unknown errors (transient issues are common in browser env)
  return true;
}

/**
 * Calculate delay for retry with exponential backoff and jitter
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay =
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter (±20%) to prevent thundering herd
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if not retryable or max retries reached
      if (!isRetryableError(lastError) || attempt === config.maxRetries) {
        throw lastError;
      }

      // Calculate delay and notify
      const delayMs = calculateRetryDelay(attempt, config);
      onRetry?.(attempt + 1, lastError, delayMs);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!;
}

/**
 * Format an AppError for display
 */
export function formatError(error: AppError): string {
  const prefix = `[${error.type}]`;
  return `${prefix} ${error.message}`;
}

/**
 * Check if an error is a cancellation
 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('cancelled') ||
      error.message.includes('aborted') ||
      error.name === 'AbortError'
    );
  }
  return false;
}
