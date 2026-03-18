/**
 * Worker Service
 * Wraps Web Worker RPC communication with type safety
 */

import type {
  WorkerAction,
  WorkerActionPayloads,
  WorkerEventType,
  WorkerEventPayloads,
} from '../types';
import { MainThreadRPC } from '../utils/workerRPC';
import { workerLogger } from '../utils/logger';

export type WorkerEventCallback = (
  payload: WorkerEventPayloads[WorkerEventType]
) => void;

/**
 * WorkerService manages Web Worker lifecycle and communication
 */
export class WorkerService {
  private worker: Worker | null = null;
  private rpc: MainThreadRPC | null = null;
  private eventSubscribers: Map<WorkerEventType, Set<WorkerEventCallback>> = new Map();
  private isInitialized = false;

  /**
   * Initialize the worker and RPC channel
   */
  initialize(workerUrl: string): void {
    if (this.isInitialized) {
      workerLogger.warn('Worker already initialized');
      return;
    }

    try {
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.rpc = new MainThreadRPC(this.worker);

      // Set up event handler to forward worker events to subscribers
      this.rpc.setWorkerMessageHandler((data) => {
        const { type, payload } = data as { type: string; payload?: Record<string, unknown> };

        if (type && type !== 'RPC_RESPONSE') {
          this.notifySubscribers(type as WorkerEventType, payload as WorkerEventPayloads[WorkerEventType]);
        }
      });

      this.isInitialized = true;
      workerLogger.info('Worker initialized');
    } catch (error) {
      workerLogger.error('Failed to initialize worker', error as Error);
      throw error;
    }
  }

  /**
   * Send an RPC request to the worker
   */
  async send<T extends WorkerAction>(
    action: T,
    payload: WorkerActionPayloads[T]
  ): Promise<unknown> {
    if (!this.rpc) {
      throw new Error('Worker not initialized');
    }

    workerLogger.debug(`Sending action: ${action}`);
    return this.rpc.send(action, payload);
  }

  /**
   * Subscribe to worker events
   */
  subscribe<T extends WorkerEventType>(
    eventType: T,
    callback: (payload: WorkerEventPayloads[T]) => void
  ): () => void {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, new Set());
    }

    const subscribers = this.eventSubscribers.get(eventType)!;
    const typedCallback = callback as unknown as WorkerEventCallback;
    subscribers.add(typedCallback);

    // Return unsubscribe function
    return () => {
      subscribers.delete(typedCallback);
      if (subscribers.size === 0) {
        this.eventSubscribers.delete(eventType);
      }
    };
  }

  /**
   * Notify all subscribers of an event
   */
  private notifySubscribers<T extends WorkerEventType>(
    eventType: T,
    payload: WorkerEventPayloads[T]
  ): void {
    const subscribers = this.eventSubscribers.get(eventType);
    if (!subscribers) return;

    for (const callback of subscribers) {
      try {
        (callback as (payload: WorkerEventPayloads[T]) => void)(payload);
      } catch (error) {
        workerLogger.error('Event subscriber error', { error: error as Error }, { eventType });
      }
    }
  }

  /**
   * Check if worker is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.rpc !== null;
  }

  /**
   * Clean up worker resources
   */
  cleanup(): void {
    if (this.rpc) {
      this.rpc.cleanup();
      this.rpc = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.eventSubscribers.clear();
    this.isInitialized = false;
    workerLogger.info('Worker cleaned up');
  }
}

// Singleton instance for the application
let workerServiceInstance: WorkerService | null = null;

export function getWorkerService(): WorkerService {
  if (!workerServiceInstance) {
    workerServiceInstance = new WorkerService();
  }
  return workerServiceInstance;
}

export default WorkerService;
