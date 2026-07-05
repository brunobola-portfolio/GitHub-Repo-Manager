import { afterEach, vi } from 'vitest'

// Skip browser-specific setup when running in Node environment (server tests)
if (typeof window !== 'undefined') {

await import('@testing-library/jest-dom')
const { cleanup, configure } = await import('@testing-library/react')

// Default waitFor / find* timeout was 1s — too tight for cold CI runners,
// which silently flaked ~37% of async assertions when CPU was contended.
// 4s is the React Testing Library recommendation for shared CI.
configure({ asyncUtilTimeout: 4000 })

// Cleanup after each test. We also defensively reset fake timers + clear any
// pending timer state so a test that called vi.useFakeTimers() without an
// explicit useRealTimers() at the end cannot contaminate later tests in the
// same worker (cross-file timer leak observed in useWorkBoard suite).
afterEach(() => {
  cleanup()
  try { vi.useRealTimers() } catch { /* not in fake-timer mode */ }
  try { vi.clearAllTimers() } catch { /* no pending timers */ }
})

// Mock window.matchMedia for theme tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock IntersectionObserver for animation tests
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

// Mock ResizeObserver for responsive components
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// Mock localStorage — includes the spec's enumeration surface (length / key(i))
// so code that sweeps stored keys (e.g. useDraftPersistence's TTL sweep)
// behaves like it does in a real browser.
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn(key => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    key: vi.fn(i => Object.keys(store)[i] ?? null),
    get length() {
      return Object.keys(store).length
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

} // end browser-only setup
