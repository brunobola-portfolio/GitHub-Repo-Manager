// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * useIsAdmin — lightweight poll of /api/auth/session-info to detect
 * whether the current session has the `users.is_admin` flag set.
 *
 * Rationale: admin is a server-bootstrapped operator role (manual SQL,
 * see server/middleware/require-admin.js). It's stable for the lifetime
 * of a session, so we don't need the 5-min poll cadence that
 * useSessionExpiry uses for the absolute-timeout countdown — one fetch
 * on mount is enough. If the user is granted admin mid-session they can
 * reload the tab to pick up the flag.
 *
 * Fail-closed: any fetch error or non-200 response returns `false`. We'd
 * rather hide the admin UI than leak a button that 403s on click.
 */
import { useState, useEffect } from 'react'
import { fetchSessionInfo } from '../api/sessionInfo'

export function useIsAdmin() {
    const [state, setState] = useState({ isAdmin: false, loading: true })

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetchSessionInfo()
                if (!res.ok) {
                    if (!cancelled) setState({ isAdmin: false, loading: false })
                    return
                }
                const data = await res.json().catch(() => null)
                if (cancelled) return
                setState({
                    isAdmin: !!data?.isAdmin,
                    loading: false,
                })
            } catch {
                if (!cancelled) setState({ isAdmin: false, loading: false })
            }
        })()
        return () => { cancelled = true }
    }, [])

    return state
}
