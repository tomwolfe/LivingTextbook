/**
 * Worker RPC Communication Utility
 * Provides UUID-based request/response mapping to prevent race conditions
 */

import type { WorkerAction, WorkerActionPayloads } from '../types';

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  action: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
}

/**
 * RPC Manager for main thread
 * Tracks pending requests and resolves promises when responses arrive
 */
export class MainThreadRPC {
  private worker: Worker;
  private pendingRequests: Map<string, PendingRequest>;
  private defaultTimeout: number;
  public onWorkerMessage: ((data: unknown) => void) | null;

  constructor(worker: Worker) {
    this.worker = worker;
    this.pendingRequests = new Map();
    this.defaultTimeout = 120000; // 2 minutes default
    this.onWorkerMessage = null;
    
    // Bind worker message handler
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }

  /**
   * Send a request to the worker and wait for response
   * @param {string} action - The action to perform
   * @param {any} payload - The data to send
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<any>}
   */
  send<T extends WorkerAction>(
    action: T,
    payload: WorkerActionPayloads[T],
    timeout: number = this.defaultTimeout
  ): Promise<unknown> {
    const id = generateUUID();
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request '${action}' timed out after ${timeout}ms`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(id, {
        action,
        resolve,
        reject,
        timeoutId,
        createdAt: Date.now(),
      });

      // Send message to worker
      this.worker.postMessage({
        id,
        type: 'RPC_REQUEST',
        action,
        payload,
      });
    });
  }

  /**
   * Handle incoming messages from worker
   */
  handleMessage(event: MessageEvent) {
    const { id, type, action, result, error, status } = event.data;

    // Handle RPC responses
    if (type === 'RPC_RESPONSE' && id) {
      const pending = this.pendingRequests.get(id);
      if (!pending) {
        console.warn(`[RPC] Received response for unknown request: ${id}`);
        return;
      }

      // Clear timeout
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);

      // Resolve or reject based on status
      if (status === 'success') {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || `${action} failed`));
      }
      return;
    }

    // Handle worker-initiated messages (events, progress, etc.)
    if (type && type !== 'RPC_RESPONSE') {
      // Forward to custom handler if set
      if (this.onWorkerMessage) {
        this.onWorkerMessage(event.data);
      }
    }
  }

  /**
   * Handle worker errors
   */
  handleError(err: ErrorEvent) {
    console.error('[Worker] Error:', err);
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Worker error: ${err.message || 'Unknown error'}`));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Set custom handler for worker-initiated messages
   */
  setWorkerMessageHandler(handler: (data: unknown) => void) {
    this.onWorkerMessage = handler;
  }

  /**
   * Clean up - reject all pending requests
   */
  cleanup() {
    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();
  }
}

/**
 * Handler function type
 */
type HandlerFunction<T = unknown> = (payload: T) => Promise<unknown>;

/**
 * RPC Manager for worker thread
 * Handles incoming requests and sends responses
 */
export class WorkerRPC {
  private handlers: Map<string, HandlerFunction>;

  constructor() {
    this.handlers = new Map();

    // Bind message handler
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Register a handler for an action
   * @param {string} action - The action to handle
   * @param {Function} handler - Async function to handle the action
   */
  register<T extends WorkerAction>(
    action: T,
    handler: (payload: WorkerActionPayloads[T]) => Promise<unknown>
  ) {
    this.handlers.set(action, handler as HandlerFunction);
  }

  /**
   * Handle incoming messages from main thread
   */
  async handleMessage(event: MessageEvent) {
    const { id, type, action, payload } = event.data;

    // Only handle RPC requests
    if (type !== 'RPC_REQUEST' || !id || !action) {
      return;
    }

    const handler = this.handlers.get(action);
    if (!handler) {
      this.sendResponse(id, action, null, `Unknown action: ${action}`, 'error');
      return;
    }

    try {
      const result = await handler(payload);
      
      // Check if result contains an ArrayBuffer to transfer
      let transfer: Transferable[] = [];
      if (result && typeof result === 'object' && 'buffer' in result && result.buffer instanceof ArrayBuffer) {
        transfer = [result.buffer];
      }
      
      this.sendResponse(id, action, result, null, 'success', transfer);
    } catch (err) {
      console.error(`[Worker] Action '${action}' failed:`, err);
      this.sendResponse(id, action, null, (err as Error).message, 'error');
    }
  }

  /**
   * Send response to main thread
   */
  sendResponse(id: string, action: string, result: unknown, error: string | null, status: 'success' | 'error', transfer?: Transferable[]) {
    const message = {
      id,
      type: 'RPC_RESPONSE',
      action,
      result,
      error,
      status,
    };
    
    if (transfer && transfer.length > 0) {
      // For workers, postMessage accepts transfer as second parameter
      (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }

  /**
   * Send an event/message to main thread (not a response)
   */
  sendEvent(type: string, payload: unknown, transfer?: Transferable[]) {
    const message = {
      type,
      payload,
      timestamp: Date.now(),
    };
    
    if (transfer && transfer.length > 0) {
      (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

export default { MainThreadRPC, WorkerRPC, generateUUID };
