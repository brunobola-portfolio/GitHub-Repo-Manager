/*
 * GitHub Repo Manager
 * Session-expiry hook — polls /api/auth/session-info and surfaces a
 * warning toast before the 7-day absolute-ceiling trips.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from './useToast'

// ============ Constants ============

// Poll interval — 5 minutes. The absolute ceiling is 7 days, so 5 min
// granularity is plenty and keeps server load negligible.
const POLL_INTERVAL_MS = 5 * 60 * 1000

// Soft warning window (< 1 hour). Shows a friendly "save your work" toast
// once per page-load (persisted via sessionStorage) so the user has time
// to wrap up before the hard expiry.
const SOFT_WARN_SECONDS = 60 * 60 // 1 hour

// Hard warning window (< 5 min). Fires a sterner toast AND attempts a
// session-renewal via POST /api/auth/refresh-session.
const HARD_WARN_SECONDS = 5 * 60 // 5 minutes

// sessionStorage keys — per-page-load state so we don't re-toast on every
// poll cycle. Cleared implicitly on tab close.
const SOFT_WARN_KEY = 'grm:session-expiry-soft-warned'
const HARD_WARN_KEY = 'grm:session-expiry-hard-warned'

// ============ Hook ============

/**
 * useSessionExpiry — poll session-info and warn before absolute expiry.
 *
 * Returns { expiresAt, expiresInSeconds } so consumers (e.g. the header
 * avatar indicator) can render an inline affordance without each
 * rendering the toast plumbing.
 *
 * Behaviour:
 *   - Polls GET /api/auth/session-info every 5 min while mounted.
 *   - Re-polls immediately when the tab becomes visible again.
 *   - Fires a soft warning toast when expiresInSeconds < 1h.
 *   - Fires a hard warning toast AND attempts POST /api/auth/refresh-session
 *     when expiresInSeconds < 5 min (to bump the rolling cookie — does
 *     NOT extend the absolute ceiling).
 *   - Each warning fires at most once per page-load (sessionStorage gate).
 *
 * @param {{ enabled?: boolean }} [opts]
 * @returns {{ expiresAt: Date|null, expiresInSeconds: number|null }}
 */
export function useSessionExpiry({ enabled = true } = {}) {
    const [state, setState] = useState({ expiresAt: null, expiresInSeconds: null })
    const { toast } = useToast()
    const toastRef = useRef(toast)
    toastRef.current = toast

    // Reset-on-unmount guard so a late fetch doesn't setState after the
    // host unmounted.
    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])

    const poll = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/session-info', {
                method: 'GET',
                credentials: 'include',
            })
            if (!res.ok) return // silent — the session-expired 401 handler
                                 // in api.js already surfaces a banner.
            const data = await res.json()

            if (!data?.authenticated) {
                if (mountedRef.current) {
                    setState({ expiresAt: null, expiresInSeconds: null })
                }
                return
            }

            // Legacy sessions report null expiry — skip warnings.
            const secs = typeof data.expiresInSeconds === 'number'
                ? data.expiresInSeconds
                : null
            const at = typeof data.expiresAt === 'string'
                ? new Date(data.expiresAt)
                : null

            if (mountedRef.current) {
                setState({ expiresAt: at, expiresInSeconds: secs })
            }

            if (secs === null) return

            // Hard warning first (more severe message wins when both trip).
            if (secs < HARD_WARN_SECONDS) {
                if (!_alreadyWarned(HARD_WARN_KEY)) {
                    _markWarned(HARD_WARN_KEY)
                    const mins = Math.max(1, Math.round(secs / 60))
                    toastRef.current?.error?.(
                        `Your session expires in ${mins} minute${mins === 1 ? '' : 's'}. Save your work immediately.`,
                        15000,
                    )
                    // Fire-and-forget — refresh-session bumps the rolling
                    // cookie but will NOT extend the 7-day absolute cap.
                    try {
                        await fetch('/api/auth/refresh-session', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                        })
                    } catch {
                        /* swallow — best-effort */
                    }
                }
                return
            }

            if (secs < SOFT_WARN_SECONDS) {
                if (!_alreadyWarned(SOFT_WARN_KEY)) {
                    _markWarned(SOFT_WARN_KEY)
                    const mins = Math.max(1, Math.round(secs / 60))
                    toastRef.current?.warning?.(
                        `Your session expires in ${mins} minutes. Save your work.`,
                        10000,
                    )
                }
            }
        } catch {
            // Network error — swallow. The next poll will pick up.
        }
    }, [])

    useEffect(() => {
        if (!enabled) return undefined

        // Initial poll kicks off as soon as the hook mounts so the header
        // indicator and first warning toast show without waiting 5 min.
        poll()

        const id = setInterval(poll, POLL_INTERVAL_MS)

        // Re-poll as soon as the user brings the tab back — a tab that
        // sat in the background for hours has stale state.
        const onVisibility = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                poll()
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility)
        }

        return () => {
            clearInterval(id)
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibility)
            }
        }
    }, [enabled, poll])

    return state
}

// ============ Internal helpers ============

function _alreadyWarned(key) {
    try {
        return typeof window !== 'undefined'
            && window.sessionStorage?.getItem?.(key) === '1'
    } catch {
        return false
    }
}

function _markWarned(key) {
    try {
        if (typeof window !== 'undefined') {
            window.sessionStorage?.setItem?.(key, '1')
        }
    } catch {
        /* sessionStorage unavailable — degrade to toasting every poll cycle */
    }
}

// Test-only helper: reset the per-page-load warning gate so tests can
// run back-to-back without stale sessionStorage leaking between cases.
export function _resetSessionExpiryWarningsForTests() {
    try {
        window.sessionStorage?.removeItem?.(SOFT_WARN_KEY)
        window.sessionStorage?.removeItem?.(HARD_WARN_KEY)
    } catch {
        /* ignore */
    }
}
