import '@testing-library/jest-dom';

// Mock IndexedDB for tests
const mockIndexedDB = {
  open: vi.fn(),
  databases: vi.fn(),
};

global.indexedDB = mockIndexedDB as unknown as IDBFactory;

// Mock WebGPU for tests
const mockGPU = {
  requestAdapter: vi.fn(),
};

Object.assign(global.navigator, {
  gpu: mockGPU,
  deviceMemory: 8,
  hardwareConcurrency: 4,
});

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-object-url');

// Mock console.warn to reduce noise in tests
global.console.warn = vi.fn();
