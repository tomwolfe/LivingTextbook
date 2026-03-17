/**
 * Worker RPC Communication Utility
 * Provides UUID-based request/response mapping to prevent race conditions
 */

/**
 * Generate a UUID v4
 */
export function generateUUID() {
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
 * RPC Manager for main thread
 * Tracks pending requests and resolves promises when responses arrive
 */
export class MainThreadRPC {
  constructor(worker) {
    this.worker = worker;
    this.pendingRequests = new Map();
    this.defaultTimeout = 120000; // 2 minutes default
    
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
  send(action, payload, timeout = this.defaultTimeout) {
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
  handleMessage(event) {
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
  handleError(err) {
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
  setWorkerMessageHandler(handler) {
    this.onWorkerMessage = handler;
  }

  /**
   * Clean up - reject all pending requests
   */
  cleanup() {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();
  }
}

/**
 * RPC Manager for worker thread
 * Handles incoming requests and sends responses
 */
export class WorkerRPC {
  constructor() {
    this.handlers = new Map();
    this.defaultTimeout = 120000;
    
    // Bind message handler
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Register a handler for an action
   * @param {string} action - The action to handle
   * @param {Function} handler - Async function to handle the action
   */
  register(action, handler) {
    this.handlers.set(action, handler);
  }

  /**
   * Handle incoming messages from main thread
   */
  async handleMessage(event) {
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
      this.sendResponse(id, action, result, null, 'success');
    } catch (err) {
      console.error(`[Worker] Action '${action}' failed:`, err);
      this.sendResponse(id, action, null, err.message, 'error');
    }
  }

  /**
   * Send response to main thread
   */
  sendResponse(id, action, result, error, status) {
    self.postMessage({
      id,
      type: 'RPC_RESPONSE',
      action,
      result,
      error,
      status,
    });
  }

  /**
   * Send an event/message to main thread (not a response)
   */
  sendEvent(type, payload) {
    self.postMessage({
      type,
      payload,
      timestamp: Date.now(),
    });
  }
}

export default { MainThreadRPC, WorkerRPC, generateUUID };
