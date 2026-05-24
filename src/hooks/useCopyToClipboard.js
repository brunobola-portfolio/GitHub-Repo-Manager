import { useState, useCallback, useRef, useEffect } from 'react'
import { copyToClipboard } from '../utils/clipboard'

/**
 * Stateful clipboard hook — keeps a `copied` flag true for `resetMs`
 * after a successful copy so callers can render a "Copied!" affordance
 * without managing setState + setTimeout + cleanup themselves.
 *
 * Previously inlined identically across 14+ components.
 *
 * @param {number} [resetMs=2000] how long the `copied` flag stays true
 * @returns {{ copied: boolean, copy: (text: string) => Promise<boolean> }}
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  // Cleanup any pending reset timer on unmount to avoid setState-on-unmounted
  // warnings if the component leaves the tree mid-display.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const copy = useCallback(async (text) => {
    const ok = await copyToClipboard(text)
    if (!ok) return false
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, resetMs)
    return true
  }, [resetMs])

  return { copied, copy }
}
