// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'

/**
 * useDraftPersistence — Linear-grade textarea drafts that survive accidental
 * tab-closes / modal-dismissals. Persists to localStorage under a stable key
 * derived from the resource (e.g. PR or issue). Cleared explicitly via the
 * returned `clear()` (call after a successful submit).
 *
 * Defensive against quota errors (private mode, full storage) — silently
 * disables persistence rather than throwing into render.
 *
 * @param {string} key — localStorage key (caller responsibility to namespace)
 * @param {string} [initial=''] — initial body when nothing in storage
 *
 * Usage:
 *   const { value, setValue, clear } = useDraftPersistence(
 *     `draft:pr-comment:${repo}:${pr}`,
 *   )
 */
export function useDraftPersistence(key, initial = '') {
    const [value, setValue] = useState(() => {
        if (!key || typeof window === 'undefined' || !window.localStorage) return initial
        try {
            const stored = window.localStorage.getItem(key)
            return stored ?? initial
        } catch {
            return initial
        }
    })

    const hadInitialKeyRef = useRef(key)

    // Persist on every change — debounced via the natural React render
    // cadence; no need for an explicit timer for this small payload.
    useEffect(() => {
        if (!key || typeof window === 'undefined' || !window.localStorage) return
        try {
            if (value && value.length > 0) {
                window.localStorage.setItem(key, value)
            } else {
                window.localStorage.removeItem(key)
            }
        } catch {
            // QuotaExceededError or SecurityError in private mode — silent.
        }
    }, [key, value])

    // Reset value when the key changes (caller switched between PRs/issues)
    useEffect(() => {
        if (hadInitialKeyRef.current === key) return
        hadInitialKeyRef.current = key
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setValue(window.localStorage.getItem(key) ?? '')
        } catch {
             
            setValue('')
        }
    }, [key])

    const clear = () => {
        setValue('')
        try {
            if (key) window.localStorage.removeItem(key)
        } catch {
            // ignore
        }
    }

    return { value, setValue, clear }
}
