/**
 * Resource Detection Utility
 *
 * Detects device memory, GPU adapter limits, and determines if the device
 * should run in "Speed Mode" (reduced quality for better performance).
 */

import type { DeviceResources, GenerationSettings } from '../types';

/**
 * Resource thresholds for Speed Mode activation
 */
export const RESOURCE_THRESHOLDS = {
  // Device memory in GB - devices with less than this will use Speed Mode
  minDeviceMemory: 8,
  // Minimum recommended VRAM in MB for SD-Turbo
  minVRAM: 4000,
  // Minimum buffer size in MB
  minBufferStorage: 256,
  // Maximum texture dimension for image generation
  minMaxTextureDimension: 2048,
} as const;

/**
 * Detect device resources and determine if Speed Mode should be enabled
 * @returns {Promise<DeviceResources>} Device resource information
 */
export async function detectDeviceResources(): Promise<DeviceResources> {
  const result: DeviceResources = {
    deviceMemory: null,
    hardwareConcurrency: null,
    hasWebGPU: false,
    hasShaderF16: false,
    isLowMemory: false,
    limitations: [],
  };

  // Check navigator.deviceMemory (Chrome/Edge only)
  if ('deviceMemory' in navigator) {
    result.deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  }

  // Check CPU cores
  if ('hardwareConcurrency' in navigator) {
    result.hardwareConcurrency = navigator.hardwareConcurrency;
  }

  // Check WebGPU support
  if ('gpu' in navigator) {
    try {
      const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu?.requestAdapter();

      if (adapter) {
        result.hasWebGPU = true;

        // Get adapter limits
        const limits = adapter.limits;
        result.hasShaderF16 = adapter.features.has('shader-f16');

        // Determine if device is resource-constrained
        const limitations: string[] = [];

        // Check device memory
        if (result.deviceMemory && result.deviceMemory < RESOURCE_THRESHOLDS.minDeviceMemory) {
          result.isLowMemory = true;
          limitations.push(`Low device memory (${result.deviceMemory}GB)`);
        }

        // Check storage buffer size (important for model loading)
        if (limits?.maxStorageBufferBindingSize &&
            limits.maxStorageBufferBindingSize < RESOURCE_THRESHOLDS.minBufferStorage * 1024 * 1024) {
          result.isLowMemory = true;
          limitations.push(`Limited buffer storage (${Math.round(limits.maxStorageBufferBindingSize / 1024 / 1024)}MB)`);
        }

        // Check texture dimension (important for image generation)
        if (limits?.maxTextureDimension2D &&
            limits.maxTextureDimension2D < RESOURCE_THRESHOLDS.minMaxTextureDimension) {
          result.isLowMemory = true;
          limitations.push(`Limited texture dimension (${limits.maxTextureDimension2D}px)`);
        }

        // Check CPU cores for parallel processing
        if (result.hardwareConcurrency && result.hardwareConcurrency < 4) {
          result.isLowMemory = true;
          limitations.push(`Limited CPU cores (${result.hardwareConcurrency})`);
        }

        result.limitations = limitations;
      }
    } catch (err) {
      console.warn('Failed to detect WebGPU resources:', err);
      result.hasWebGPU = false;
      result.isLowMemory = true;
      result.limitations.push('WebGPU initialization failed');
    }
  } else {
    result.hasWebGPU = false;
    result.isLowMemory = true;
    result.limitations.push('WebGPU not available');
  }

  return result;
}

/**
 * Get recommended settings based on device resources
 * @param {DeviceResources} resources - Device resource information
 * @returns {GenerationSettings} Recommended settings for generation
 */
export function getRecommendedSettings(resources: DeviceResources): GenerationSettings {
  if (!resources.isLowMemory) {
    return {
      mode: 'quality',
      imageSteps: 4, // SD-Turbo default
      imageResolution: { width: 512, height: 512 },
      skipImageGeneration: false,
      description: 'Full quality mode with image generation',
    };
  }

  // Determine level of constraint
  const severeConstraints = resources.limitations.length >= 2;

  if (severeConstraints) {
    return {
      mode: 'speed',
      imageSteps: 1, // Minimum for SD-Turbo
      imageResolution: { width: 256, height: 256 },
      skipImageGeneration: true,
      description: 'Speed mode: text-only generation (device resources limited)',
    };
  }

  return {
    mode: 'speed',
    imageSteps: 2, // Reduced steps
    imageResolution: { width: 384, height: 384 },
    skipImageGeneration: false,
    description: 'Speed mode: reduced quality for better performance',
  };
}

/**
 * Format memory size for display
 * @param {number} bytes - Memory size in bytes
 * @returns {string} Formatted memory size
 */
export function formatMemorySize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  }
  return `${(bytes / 1024).toFixed(0)}KB`;
}

export default {
  detectDeviceResources,
  getRecommendedSettings,
  formatMemorySize,
  RESOURCE_THRESHOLDS,
};
