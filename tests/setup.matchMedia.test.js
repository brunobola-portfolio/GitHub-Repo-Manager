import { describe, it, expect, vi } from 'vitest'

/**
 * Regression guard for the tests/setup.js `window.matchMedia` stub.
 *
 * The stub used to be built with `vi.fn().mockImplementation(...)`. Any
 * suite calling `vi.resetAllMocks()` (a common pattern — see
 * InboxPanel.test.jsx, useInbox.test.jsx, AutoFixDrawer.test.jsx,
 * useAutoFixPlan.test.jsx) strips the mock implementation from every
 * vi.fn in the process, including this global one. `window.matchMedia(...)`
 * then returns `undefined`, and any component that calls framer-motion's
 * real `useReducedMotion()` (which reads `matchMedia(...).addEventListener`)
 * throws `Cannot read properties of undefined (reading 'addEventListener')`
 * mid-render. This caused a real CI failure on PR #196.
 *
 * The fix: the global stub must be a PLAIN function, not a `vi.fn`, so
 * `vi.resetAllMocks()` / `vi.restoreAllMocks()` cannot strip it.
 */
describe('tests/setup.js — window.matchMedia stub', () => {
    it('returns a complete MediaQueryList-like object after vi.resetAllMocks()', () => {
        vi.resetAllMocks()

        const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

        expect(mql).toBeTruthy()
        expect(mql.matches).toBe(false)
        expect(mql.media).toBe('(prefers-reduced-motion: reduce)')
        expect(typeof mql.addEventListener).toBe('function')
        expect(typeof mql.removeEventListener).toBe('function')
        expect(typeof mql.addListener).toBe('function')
        expect(typeof mql.removeListener).toBe('function')
        expect(typeof mql.dispatchEvent).toBe('function')
        expect(mql.onchange).toBe(null)

        // Must not throw — this is exactly the call framer-motion's
        // useReducedMotion() makes internally.
        expect(() => mql.addEventListener('change', () => {})).not.toThrow()
    })

    it('still returns a working stub after vi.restoreAllMocks()', () => {
        vi.restoreAllMocks()

        const mql = window.matchMedia('(min-width: 1024px)')
        expect(typeof mql.addEventListener).toBe('function')
    })

    it('is not itself a vi mock (so resetAllMocks/restoreAllMocks cannot strip it)', () => {
        expect(vi.isMockFunction(window.matchMedia)).toBe(false)
    })
})
