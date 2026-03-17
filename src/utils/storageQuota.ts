/**
 * Storage Quota Management Utility
 * 
 * Provides functions to check available storage and prevent model downloads
 * when insufficient space is available.
 */

import type { Result } from '../types';

/**
 * Estimated model sizes in bytes
 */
export const MODEL_SIZES = {
  // SmolLM2-135M (fast model)
  FAST_TEXT_MODEL: 300 * 1024 * 1024, // ~300MB
  // Qwen2.5-0.5B (quality model)
  QUALITY_TEXT_MODEL: 800 * 1024 * 1024, // ~800MB
  // SD-Turbo image model
  IMAGE_MODEL: 400 * 1024 * 1024, // ~400MB
  // Total for all models
  ALL_MODELS: 1.5 * 1024 * 1024 * 1024, // ~1.5GB
} as const;

/**
 * Storage requirement levels
 */
export type StorageRequirement = 'fast' | 'quality' | 'image' | 'all';

/**
 * Storage requirement sizes mapping
 */
export const STORAGE_REQUIREMENTS: Record<StorageRequirement, number> = {
  fast: MODEL_SIZES.FAST_TEXT_MODEL,
  quality: MODEL_SIZES.QUALITY_TEXT_MODEL,
  image: MODEL_SIZES.IMAGE_MODEL,
  all: MODEL_SIZES.ALL_MODELS,
};

/**
 * Storage quota information
 */
export interface StorageQuotaInfo {
  usage: number;
  quota: number;
  available: number;
  usageFormatted: string;
  quotaFormatted: string;
  availableFormatted: string;
  percentUsed: number;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get current storage quota information
 */
export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  try {
    if (!navigator.storage || !navigator.storage.estimate) {
      // Fallback if Storage Manager API not available
      return {
        usage: 0,
        quota: 0,
        available: 0,
        usageFormatted: 'Unknown',
        quotaFormatted: 'Unknown',
        availableFormatted: 'Unknown',
        percentUsed: 0,
      };
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const available = quota - usage;
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

    return {
      usage,
      quota,
      available,
      usageFormatted: formatBytes(usage),
      quotaFormatted: formatBytes(quota),
      availableFormatted: formatBytes(available),
      percentUsed,
    };
  } catch (err) {
    console.warn('Failed to get storage quota:', err);
    return {
      usage: 0,
      quota: 0,
      available: 0,
      usageFormatted: 'Error',
      quotaFormatted: 'Error',
      availableFormatted: 'Error',
      percentUsed: 0,
    };
  }
}

/**
 * Check if there's enough storage for a model download
 * @param requirement - Which model(s) to check for
 * @param safetyMargin - Additional buffer in bytes (default: 100MB)
 */
export async function checkStorageAvailability(
  requirement: StorageRequirement,
  safetyMargin: number = 100 * 1024 * 1024
): Promise<Result<{ quota: StorageQuotaInfo; canDownload: boolean }, string>> {
  try {
    const quota = await getStorageQuota();
    const requiredSize = STORAGE_REQUIREMENTS[requirement] + safetyMargin;
    const canDownload = quota.available >= requiredSize;

    return {
      success: true,
      data: {
        quota,
        canDownload,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || 'Failed to check storage',
    };
  }
}

/**
 * Assert that there's enough storage, throw error if not
 * @param requirement - Which model(s) to check for
 * @throws {Error} If insufficient storage
 */
export async function assertStorageAvailability(requirement: StorageRequirement): Promise<void> {
  const result = await checkStorageAvailability(requirement);
  
  if (!result.success) {
    throw new Error(`Storage check failed: ${result.error}`);
  }

  if (!result.data.canDownload) {
    const { quota } = result.data;
    const required = STORAGE_REQUIREMENTS[requirement];
    const throwMsg = `Insufficient storage. Required: ${formatBytes(required)}, Available: ${quota.availableFormatted}. ` +
      `Please free up space or use models with smaller footprint.`;
    throw new Error(throwMsg);
  }
}

/**
 * Get storage status for UI display
 */
export async function getStorageStatus(): Promise<{
  status: 'ok' | 'warning' | 'critical' | 'error';
  message: string;
  quota: StorageQuotaInfo;
}> {
  try {
    const quota = await getStorageQuota();
    
    if (quota.quota === 0) {
      return {
        status: 'error',
        message: 'Storage information unavailable',
        quota,
      };
    }

    const availableForModels = quota.available - MODEL_SIZES.ALL_MODELS;
    
    if (availableForModels > 500 * 1024 * 1024) {
      // More than 500MB spare
      return {
        status: 'ok',
        message: `Plenty of space available (${quota.availableFormatted})`,
        quota,
      };
    } else if (availableForModels > 0) {
      // Some space but not much
      return {
        status: 'warning',
        message: `Limited space (${quota.availableFormatted}). Consider clearing cache.`,
        quota,
      };
    } else {
      // Not enough for all models
      return {
        status: 'critical',
        message: `Low storage (${quota.availableFormatted}). Model downloads may fail.`,
        quota,
      };
    }
  } catch (err) {
    return {
      status: 'error',
      message: 'Failed to check storage',
      quota: {
        usage: 0,
        quota: 0,
        available: 0,
        usageFormatted: 'Error',
        quotaFormatted: 'Error',
        availableFormatted: 'Error',
        percentUsed: 0,
      },
    };
  }
}

export default {
  getStorageQuota,
  checkStorageAvailability,
  assertStorageAvailability,
  getStorageStatus,
  formatBytes,
  MODEL_SIZES,
  STORAGE_REQUIREMENTS,
};
