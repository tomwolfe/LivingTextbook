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

// Mock navigator properties properly using getters
const originalNavigator = global.navigator;
Object.defineProperty(global.navigator, 'gpu', {
  value: mockGPU,
  writable: true,
  configurable: true,
});
Object.defineProperty(global.navigator, 'deviceMemory', {
  value: 8,
  writable: true,
  configurable: true,
});
Object.defineProperty(global.navigator, 'hardwareConcurrency', {
  value: 4,
  writable: true,
  configurable: true,
});

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-object-url');

// Mock console.warn to reduce noise in tests
global.console.warn = vi.fn();
