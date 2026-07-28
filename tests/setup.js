import { afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Give every worker process its own SQLite file.
//
// The `forks` pool runs N processes concurrently and, with DATA_DIR unset,
// every one of them resolved the SAME `getDataDir()/manager.db`. Opening a
// shared file under that contention makes the `journal_mode = WAL` pragma
// throw `SqliteError: disk I/O error` — which surfaces as an entire suite
// failing to import with ZERO failed tests, on a different random file each
// run, always passing in isolation. That is the intermittent
// "module-collection failure" that has been training reflexive re-runs; it is
// contention, not a bug in whichever file drew the short straw.
//
// Set before any test file imports server/db.js, and cleaned up when the
// worker exits. An explicit DATA_DIR is honoured so a test that needs a
// specific location still gets it.
if (!process.env.DATA_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'grm-vitest-'))
  process.env.DATA_DIR = dir
  process.on('exit', () => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* worker teardown */ }
  })
}

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

// Mock window.matchMedia for theme tests.
//
// IMPORTANT: this must be a PLAIN function, not `vi.fn()`. A vi.fn-based
// stub gets its implementation stripped by any suite that calls
// `vi.resetAllMocks()` / `vi.restoreAllMocks()` (a common pattern — see
// InboxPanel.test.jsx, useInbox.test.jsx, AutoFixDrawer.test.jsx), which
// makes `window.matchMedia(...)` return `undefined` afterwards. Any
// component that then calls framer-motion's real `useReducedMotion()`
// (which reads `matchMedia(...).addEventListener`) throws mid-render —
// this caused a real CI failure on PR #196. A plain function is immune to
// resetAllMocks/restoreAllMocks, so it survives no matter what a suite
// resets. Suites that need their own controllable matchMedia (useTheme,
// useMediaQuery, App.test.jsx, CommunityHealthDashboard.test.jsx) simply
// reassign `window.matchMedia` themselves — that still works fine, since
// they replace the whole property rather than mutating this one.
function createMatchMediaStub(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: function () {},
    removeListener: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true },
  }
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: createMatchMediaStub,
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
