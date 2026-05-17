import { useCallback } from 'react'

/**
 * Optimistic mutation hook with built-in revert + Undo toast support.
 *
 * Usage:
 *   const { run } = useOptimisticMutation({ apply, revert, fn, inverse, onToast })
 *   await run(payload)
 *
 * apply(payload)   — synchronous UI update before the request fires
 * revert(payload)  — synchronous UI rollback when fn() rejects
 * fn(payload)      — the remote mutation; returns Promise
 * inverse(payload) — optional: undoes the mutation on the server (for Undo toast)
 * onToast({type, message, undo, successMessage}) — surface success/error UX
 *
 * Errors thrown by apply() are caught and surfaced via onToast({type: 'error'}).
 */

export function useOptimisticMutation({ apply, revert, fn, inverse, onToast, successMessage = 'Done' }) {
  const run = useCallback(async (payload) => {
    try {
      apply(payload)
    } catch (err) {
      onToast?.({ type: 'error', message: err?.message || 'Action failed' })
      return
    }
    try {
      await fn(payload)
      onToast?.({
        type: 'success',
        message: successMessage,
        undo: inverse
          ? async () => { revert(payload); await inverse(payload) }
          : undefined,
      })
    } catch (err) {
      try { revert(payload) } catch { /* swallow */ }
      onToast?.({ type: 'error', message: err?.message || 'Action failed' })
    }
  }, [apply, revert, fn, inverse, onToast, successMessage])

  return { run }
}
