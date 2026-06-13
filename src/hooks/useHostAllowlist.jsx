import { useState, useEffect, useCallback, useRef } from 'react'

const IDLE = { status: 'idle', allowed: null, patterns: [], usingDefault: true, canEdit: false }

/**
 * Live check of a hostname against the backend Azure host allowlist
 * (`GET /api/azure/host-allowlist?host=`). Debounced so it can be wired
 * directly to a text input.
 *
 * Returns:
 *   - status: 'idle' | 'checking' | 'allowed' | 'blocked'
 *   - allowed / patterns / usingDefault / canEdit: mirror of the API response
 *   - refresh(): re-check immediately (e.g., after adding the host)
 */
export function useHostAllowlist(host, { debounceMs = 400 } = {}) {
  const [state, setState] = useState(IDLE)
  const requestSeq = useRef(0)

  const check = useCallback(async (value) => {
    const seq = ++requestSeq.current
    const clean = (value || '').trim().toLowerCase()
    if (!clean) {
      setState(IDLE)
      return
    }
    setState((prev) => ({ ...prev, status: 'checking' }))
    try {
      const res = await fetch(`/api/azure/host-allowlist?host=${encodeURIComponent(clean)}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (seq !== requestSeq.current) return
      setState({
        status: data.allowed ? 'allowed' : 'blocked',
        allowed: !!data.allowed,
        patterns: data.patterns || [],
        usingDefault: !!data.usingDefault,
        canEdit: !!data.canEdit,
      })
    } catch {
      // Network/HTTP failure — stay quiet rather than block the form.
      if (seq === requestSeq.current) setState(IDLE)
    }
  }, [])

  useEffect(() => {
    // Invalidate any in-flight check for the previous host immediately —
    // otherwise its response could land during the debounce window and be
    // shown against the new value.
    requestSeq.current++
    const clean = (host || '').trim()
    if (!clean) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived state when host goes away
      setState(IDLE)
      return
    }
    const t = setTimeout(() => check(clean), debounceMs)
    return () => clearTimeout(t)
  }, [host, debounceMs, check])

  const refresh = useCallback(() => check(host), [check, host])

  return { ...state, refresh }
}
