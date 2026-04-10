import { useEffect } from 'react'

/**
 * Lock document.body scroll while isLocked is true.
 *
 * Safe for stacked modals: uses a module-level reference counter so
 * nested `useBodyScrollLock(true)` calls are counted and the body
 * `overflow` style is only restored when the last lock is released.
 *
 * The initial body `overflow` value is snapshotted on the 0→1 transition
 * and restored on the 1→0 transition, so a page that started with
 * `overflow: hidden` (e.g. body scroll already locked by another system)
 * will be left in that state after all modals close.
 *
 * Used by Modal.jsx and WizardPanel.jsx to prevent background page
 * scrolling when a modal or wizard is open.
 *
 * @param {boolean} isLocked
 * @returns {void}
 */

// Module-level lock state shared across all call sites.
let lockCount = 0
let savedOverflow = ''

export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return

    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++

    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow
      }
    }
  }, [isLocked])
}

// --- Test helper ---------------------------------------------------------
// Exposed ONLY for tests: reset the module-level counter between tests.
// Not part of the public API.
export function __resetBodyScrollLockForTests() {
  lockCount = 0
  savedOverflow = ''
}
