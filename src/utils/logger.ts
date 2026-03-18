/**
 * Structured Logging Utility
 * Replaces console.* with typed, level-aware logging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
  error?: Error | unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  group(label: string): void;
  groupEnd(): void;
}

/**
 * Check if we're in a development environment
 */
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

/**
 * Format context for logging
 */
function formatContext(context?: LogContext): unknown {
  if (!context) return undefined;
  return context;
}

/**
 * Create a logger with optional prefix
 */
export function createLogger(prefix?: string): Logger {
  const fullPrefix = prefix ? `[${prefix}]` : '[App]';

  return {
    debug(message, context) {
      if (!isDevelopment) return;
      console.debug(`${fullPrefix} [DEBUG] ${message}`, formatContext(context));
    },

    info(message, context) {
      if (!isDevelopment) return;
      console.info(`${fullPrefix} [INFO] ${message}`, formatContext(context));
    },

    warn(message, context) {
      console.warn(`${fullPrefix} [WARN] ${message}`, context ? { ...context } : undefined);
    },

    error(message, error, context) {
      console.error(`${fullPrefix} [ERROR] ${message}`, context ? { ...context } : undefined);
      if (error) {
        console.error(error);
      }
    },

    group(label) {
      if (!isDevelopment) return;
      console.group(`${fullPrefix} ${label}`);
    },

    groupEnd() {
      if (!isDevelopment) return;
      console.groupEnd();
    },
  };
}

/**
 * Default application logger
 */
export const logger = createLogger();

/**
 * Worker-specific logger (for use in web workers)
 */
export const workerLogger = createLogger('Worker');

/**
 * Model lifecycle logger
 */
export const modelLogger = createLogger('Model');

/**
 * Generation logger
 */
export const generationLogger = createLogger('Generation');

/**
 * Storage logger
 */
export const storageLogger = createLogger('Storage');
