// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.
import { AUTH_ENDPOINTS } from '../config'
import { apiCall, markSessionEnded } from './api'

/**
 * The one way to sign out. Every "Sign out" in the app goes through here, so
 * they all end on the same clean landing page with the same confirmation.
 *
 * A fresh load of the landing page, not a reload: reloading kept the
 * signed-in route (#/repo/…) and every in-memory cache of the old session.
 * When the server could not confirm the logout, land without the
 * confirmation: the landing page's own session check then shows the truth.
 *
 * @param {{ navigate?: (url: string) => void }} [deps]
 */
export async function signOut({ navigate = (url) => window.location.replace(url) } = {}) {
    markSessionEnded()
    try {
        await apiCall(AUTH_ENDPOINTS.logout, { method: 'POST' })
        navigate('/?signed_out=1')
    } catch {
        navigate('/')
    }
}
