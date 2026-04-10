import { useEffect } from 'react'

/**
 * Lock document.body scroll while isLocked is true.
 * Restores the previous overflow value on cleanup.
 *
 * Used by Modal.jsx and WizardPanel.jsx to prevent background page
 * scrolling when a modal or wizard is open.
 */
export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isLocked])
}
