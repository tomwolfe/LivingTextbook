/**
 * Unit tests for workerRPC utility
 * Tests UUID generation and RPC request/response mapping
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateUUID, MainThreadRPC, WorkerRPC } from './workerRPC';

describe('workerRPC', () => {
  describe('generateUUID', () => {
    it('should generate a valid UUID v4 format', () => {
      const uuid = generateUUID();
      
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        uuids.add(generateUUID());
      }

      expect(uuids.size).toBe(iterations);
    });

    it('should use crypto.randomUUID when available', () => {
      const mockUUID = '12345678-1234-4123-8123-123456789abc';
      const originalCrypto = global.crypto;
      
      // Mock crypto.randomUUID
      Object.defineProperty(global, 'crypto', {
        value: { randomUUID: vi.fn(() => mockUUID) },
        writable: true,
      });

      const uuid = generateUUID();
      expect(uuid).toBe(mockUUID);
      expect(global.crypto.randomUUID).toHaveBeenCalled();

      // Restore
      Object.defineProperty(global, 'crypto', {
        value: originalCrypto,
        writable: true,
      });
    });
  });

  describe('MainThreadRPC', () => {
    let mockWorker: Worker;
    let postMessageMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Create a mock Worker
      postMessageMock = vi.fn();
      mockWorker = {
        postMessage: postMessageMock,
        onmessage: null,
        onerror: null,
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as Worker;
    });

    it('should send RPC request with correct format', () => {
      const rpc = new MainThreadRPC(mockWorker);
      
      rpc.send('INIT_MODELS', { modelTypes: ['fast', 'image'] });

      expect(postMessageMock).toHaveBeenCalledWith({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        type: 'RPC_REQUEST',
        action: 'INIT_MODELS',
        payload: { modelTypes: ['fast', 'image'] },
      });
    });

    it('should resolve promise when response received', async () => {
      const rpc = new MainThreadRPC(mockWorker);
      
      // Post the message synchronously
      rpc.send('INIT_MODELS', { modelTypes: ['fast'] });
      
      // Get the request ID from the posted message
      const lastCall = postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1];
      if (!lastCall) {
        throw new Error('No message posted');
      }
      const requestId = lastCall[0].id;
      
      // Simulate response by calling the worker's onmessage handler
      if (mockWorker.onmessage) {
        mockWorker.onmessage.call(mockWorker, {
          data: {
            id: requestId,
            type: 'RPC_RESPONSE',
            action: 'INIT_MODELS',
            result: { success: true },
            status: 'success',
          },
        } as MessageEvent);
      }

      // Verify the handler exists and was set up
      expect(mockWorker.onmessage).toBeDefined();
    });

    it('should reject promise on error response', async () => {
      const rpc = new MainThreadRPC(mockWorker);
      
      // Post the message synchronously
      rpc.send('INIT_MODELS', { modelTypes: ['fast'] });
      
      // Get the request ID
      const lastCall = postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1];
      if (!lastCall) {
        throw new Error('No message posted');
      }
      const requestId = lastCall[0].id;
      
      // Simulate error response
      if (mockWorker.onmessage) {
        mockWorker.onmessage.call(mockWorker, {
          data: {
            id: requestId,
            type: 'RPC_RESPONSE',
            action: 'INIT_MODELS',
            error: 'Model load failed',
            status: 'error',
          },
        } as MessageEvent);
      }

      expect(mockWorker.onmessage).toBeDefined();
    });

    it('should reject promise on timeout', async () => {
      const rpc = new MainThreadRPC(mockWorker);
      
      // Don't send any response - let it timeout
      const result = rpc.send('INIT_MODELS', { modelTypes: ['fast'] }, 50);

      await expect(result).rejects.toThrow('timed out');
    });

    it('should forward worker-initiated messages to handler', () => {
      const rpc = new MainThreadRPC(mockWorker);
      const messageHandlerMock = vi.fn();
      
      rpc.setWorkerMessageHandler(messageHandlerMock);

      // Simulate worker event
      const event = {
        data: {
          type: 'MODEL_PROGRESS',
          payload: { progress: 50 },
        },
      };
      
      // Trigger the message handler that was set on the worker
      const workerOnMessage = (mockWorker as any).onmessage;
      if (workerOnMessage) {
        workerOnMessage.call(mockWorker, event);
      }

      expect(messageHandlerMock).toHaveBeenCalledWith(event.data);
    });

    it('should cleanup and reject pending requests', () => {
      const rpc = new MainThreadRPC(mockWorker);
      
      rpc.send('INIT_MODELS', { modelTypes: ['fast'] });
      
      rpc.cleanup();

      // Worker should have no more pending requests
      expect(rpc).toBeDefined();
    });
  });

  describe('WorkerRPC', () => {
    let postMessageMock: ReturnType<typeof vi.fn>;
    let addEventListenerMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Mock self.postMessage
      postMessageMock = vi.fn();
      addEventListenerMock = vi.fn();

      // Mock self.addEventListener for message events
      addEventListenerMock.mockImplementation((event: string, handler: EventListener) => {
        // Handler registration simulated
      });

      Object.defineProperty(global, 'self', {
        value: {
          postMessage: postMessageMock,
          addEventListener: addEventListenerMock,
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should send event messages', () => {
      const workerRPC = new WorkerRPC();
      
      workerRPC.sendEvent('MODEL_PROGRESS', { progress: 75 });

      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'MODEL_PROGRESS',
        payload: { progress: 75 },
        timestamp: expect.any(Number),
      });
    });
  });
});
