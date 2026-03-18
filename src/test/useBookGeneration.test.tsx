/**
 * Integration Tests for Book Generation Flow
 * Tests the complete generation pipeline with mocked worker
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBookGeneration } from '../hooks/useBookGeneration';
import type { BookSettings, OutlineItem, Book } from '../types';

// Mock worker RPC
const mockSubscribeToWorkerEvents = vi.fn();
const mockUnsubscribe = vi.fn();
const mockGenerateOutline = vi.fn();
const mockStartBookGeneration = vi.fn();
const mockCancelBookGeneration = vi.fn();

// Type for global test storage
interface TestGlobal {
  workerCallback?: (data: { type: string; payload?: Record<string, unknown> }) => void;
}

declare const global: typeof globalThis & TestGlobal;

describe('useBookGeneration Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeToWorkerEvents.mockImplementation((callback) => {
      // Store callback for later use in tests
      global.workerCallback = callback;
      return mockUnsubscribe;
    });
  });

  afterEach(() => {
    delete global.workerCallback;
  });

  const mockSettings: BookSettings = {
    subject: 'Test Subject',
    tone: 0.5,
    style: 0.5,
    complexity: 0.5,
    level: 'Student',
    numPages: 3,
  };

  const mockOutline: OutlineItem[] = [
    { title: 'Introduction', focus: 'Basic concepts' },
    { title: 'Deep Dive', focus: 'Advanced topics' },
    { title: 'Conclusion', focus: 'Summary' },
  ];

  describe('Initialization', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      expect(result.current.bookData).toBeNull();
      expect(result.current.outline).toBeNull();
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generatingPages).toEqual([]);
      expect(result.current.generationError).toBeNull();
    });
  });

  describe('Outline Generation', () => {
    it('should parse valid JSON outline', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      const jsonResponse = JSON.stringify([
        { title: 'Page 1', focus: 'Introduction' },
        { title: 'Page 2', focus: 'Details' },
      ]);

      const outline = result.current.parseOutline(jsonResponse, 2);

      expect(outline).toHaveLength(2);
      expect(outline[0].title).toBe('Page 1');
      expect(outline[0].focus).toBe('Introduction');
    });

    it('should parse outline with markdown code blocks', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      const markdownResponse = `
        Here's your outline:
        \`\`\`json
        [
          {"title": "Intro", "focus": "Basics"},
          {"title": "Outro", "focus": "Wrap up"}
        ]
        \`\`\`
      `;

      const outline = result.current.parseOutline(markdownResponse, 2);

      expect(outline).toHaveLength(2);
      expect(outline[0].title).toBe('Intro');
    });

    it('should use fallback when parsing fails', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      const invalidResponse = 'This is not JSON at all';

      const outline = result.current.parseOutline(invalidResponse, 3);

      expect(outline).toHaveLength(3);
      expect(outline[0].title).toBe('Page 1');
    });

    it('should extract JSON from conversational responses', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      const conversationalResponse = `
        Sure! I'd be happy to help you create an outline.
        Here's what I came up with:
        [
          {"title": "Getting Started", "focus": "Setup"},
          {"title": "Advanced Usage", "focus": "Tips"}
        ]
        Let me know if you need any changes!
      `;

      const outline = result.current.parseOutline(conversationalResponse, 2);

      expect(outline).toHaveLength(2);
      expect(outline[0].title).toBe('Getting Started');
    });
  });

  describe('Book Generation Flow', () => {
    it('should start generation successfully', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      expect(mockGenerateOutline).toHaveBeenCalledWith(
        'Test Subject',
        mockSettings,
        3
      );

      expect(result.current.isGenerating).toBe(true);
      expect(result.current.outline).toEqual(mockOutline);
      expect(result.current.bookData).not.toBeNull();
      expect(result.current.bookData?.subject).toBe('Test Subject');
    });

    it('should handle PAGE_START events', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      // Simulate PAGE_START event
      await act(async () => {
        global.workerCallback?.({
          type: 'PAGE_START',
          payload: { pageNum: 0 },
        });
      });

      expect(result.current.generatingPages).toContain(0);
      expect(result.current.getPageStatus(0)).toBe('generating');
    });

    it('should handle PAGE_COMPLETE events', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      // Simulate PAGE_COMPLETE event
      await act(async () => {
        global.workerCallback?.({
          type: 'PAGE_COMPLETE',
          payload: {
            pageNum: 0,
            pageData: {
              title: 'Introduction',
              content: 'This is the content',
              quip: 'A witty remark',
            },
          },
        });
      });

      expect(result.current.generatingPages).not.toContain(0);
      expect(result.current.getPageStatus(0)).toBe('complete');
      expect(result.current.bookData?.pages[0]?.content).toBe('This is the content');
    });

    it('should handle PAGE_ERROR events', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      // Simulate PAGE_ERROR event
      await act(async () => {
        global.workerCallback?.({
          type: 'PAGE_ERROR',
          payload: { pageNum: 0, error: 'Generation failed' },
        });
      });

      expect(result.current.getPageStatus(0)).toBe('error');
      expect(result.current.generationError).not.toBeNull();
    });

    it('should handle QUEUE_COMPLETE event', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      // Simulate QUEUE_COMPLETE event
      await act(async () => {
        global.workerCallback?.({
          type: 'QUEUE_COMPLETE',
          payload: {},
        });
      });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generatingPages).toEqual([]);
    });

    it('should cancel generation', async () => {
      mockGenerateOutline.mockResolvedValue(JSON.stringify(mockOutline));
      mockStartBookGeneration.mockResolvedValue(undefined);
      mockCancelBookGeneration.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          cancelBookGeneration: mockCancelBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await act(async () => {
        await result.current.startGeneration(mockSettings, 3);
      });

      await act(async () => {
        await result.current.cancelGeneration();
      });

      expect(mockCancelBookGeneration).toHaveBeenCalled();
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe('Book Persistence', () => {
    it('should load a saved book with page states', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      const savedBook = {
        id: 'test-book-1',
        subject: 'Saved Subject',
        pages: [
          {
            title: 'Page 1',
            content: 'Content 1',
            quip: 'Quip 1',
          },
          {
            title: 'Page 2',
            content: 'Content 2',
            quip: null,
          },
        ],
        settings: mockSettings,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as const;

      act(() => {
        result.current.loadBook(savedBook as unknown as Book);
      });

      expect(result.current.bookData).not.toBeNull();
      expect(result.current.bookData?.subject).toBe('Saved Subject');
      // pageStates is added by the hook internally
      expect((result.current.bookData as unknown as { pageStates?: unknown[] }).pageStates).toHaveLength(2);
      expect(result.current.getPageStatus(0)).toBe('complete');
      expect(result.current.getPageStatus(1)).toBe('complete');
    });

    it('should clear book data', () => {
      const { result } = renderHook(() =>
        useBookGeneration({
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      act(() => {
        result.current.loadBook({
          subject: 'Test',
          pages: [{ title: 'P1', content: 'C1' }],
          settings: mockSettings,
        });
      });

      expect(result.current.bookData).not.toBeNull();

      act(() => {
        result.current.clearBook();
      });

      expect(result.current.bookData).toBeNull();
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle outline generation failure', async () => {
      mockGenerateOutline.mockRejectedValue(new Error('Outline failed'));

      const { result } = renderHook(() =>
        useBookGeneration({
          generateOutline: mockGenerateOutline,
          startBookGeneration: mockStartBookGeneration,
          subscribeToWorkerEvents: mockSubscribeToWorkerEvents,
        })
      );

      await expect(
        act(async () => {
          await result.current.startGeneration(mockSettings, 3);
        })
      ).rejects.toThrow();

      expect(result.current.bookData).toBeNull();
      expect(result.current.isGenerating).toBe(false);
    });
  });
});
