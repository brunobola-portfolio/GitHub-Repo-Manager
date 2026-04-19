import { useCallback, useEffect, useState } from 'react'

/**
 * Global Cmd+K / Ctrl+K listener + open/close state.
 * Safe to call inside an input — uses Cmd/Ctrl modifier, not bare key.
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  return { isOpen, open, close, toggle }
}
