import { useCallback, useSyncExternalStore } from 'react'

/**
 * Canonical viewport breakpoints (px). These mirror Tailwind's defaults — the
 * app's markup is overwhelmingly Tailwind, so JS breakpoint checks must agree
 * with the `sm:`/`md:`/`lg:`/`xl:` utilities used in components. This is the
 * single source of truth: `useResponsiveLayout` and `useBelowBreakpoint` both
 * read from here instead of re-declaring magic numbers.
 */
export const BREAKPOINTS = Object.freeze({
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
})

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * SSR-safe (returns false when `window` is unavailable) and re-subscribes if
 * the query string changes.
 *
 * @param {string} query - e.g. `(max-width: 767px)`
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'

  const subscribe = useCallback((onStoreChange) => {
    if (!supported) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onStoreChange)
    return () => mql.removeEventListener('change', onStoreChange)
  }, [query, supported])

  const getSnapshot = () => (supported ? window.matchMedia(query).matches : false)

  // useSyncExternalStore re-reads getSnapshot on every notification and on
  // query change, so there is no setState-in-effect and no stale value when
  // the query string changes between renders. Server snapshot is always false.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * True when the viewport is BELOW the named breakpoint — i.e. the compact/
 * mobile side of it. `useBelowBreakpoint('md')` ≡ `(max-width: 767px)`.
 *
 * @param {keyof typeof BREAKPOINTS} name
 * @returns {boolean}
 */
export function useBelowBreakpoint(name) {
  const px = BREAKPOINTS[name]
  if (px == null) throw new Error(`useBelowBreakpoint: unknown breakpoint "${name}"`)
  return useMediaQuery(`(max-width: ${px - 1}px)`)
}
