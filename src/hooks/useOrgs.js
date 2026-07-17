/*
 * GitHub Repo Manager
 * Organization management, stats, and activity hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
    safeParseJson,
    ApiError,
    ErrorType,
    isSessionExpired
} from '../utils/api'
import { API_BASE } from '../config'

// Mock data for orgs/stats/activity loads lazily from src/__mocks__/mockOrgs.js.
// Each callsite inlines `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` so
// Vite's static analysis can eliminate the dynamic import() in prod builds.

/**
 * Hook for organization management, dashboard stats, and activity feed.
 *
 * @param {object|null} user - The authenticated user object (null when logged out)
 * @returns {object} Organization state and operations
 */
export function useOrgs(user) {
    const [orgs, setOrgs] = useState([])
    const [selectedOrg, setSelectedOrg] = useState(null)
    const [orgRepos, setOrgRepos] = useState([])
    const [stats, setStats] = useState(null)
    const [activity, setActivity] = useState([])
    const [error, setError] = useState(null)
    const errorTimerRef = useRef(null)

    const setTimedError = useCallback((msg) => {
        setError(msg)
        clearTimeout(errorTimerRef.current)
        errorTimerRef.current = setTimeout(() => setError(null), 10000)
    }, [])

    // Clean up error timer on unmount
    useEffect(() => {
        return () => clearTimeout(errorTimerRef.current)
    }, [])

    /**
     * Fetch user's organizations
     */
    const fetchOrgs = useCallback(async () => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { generateMockOrgs } = await import('../__mocks__/mockOrgs.js')
            setOrgs(generateMockOrgs())
            return
        }
        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_BASE}/orgs`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setOrgs(Array.isArray(data) ? data : [])
            } else if (r.status === 401) {
                return
            }
        } catch (e) {
            if (e instanceof ApiError && e.type === ErrorType.AUTHENTICATION) return
        }
    }, [])

    /**
     * Fetch repos for a specific organization
     */
    async function fetchOrgRepos(orgLogin, pageNum = 1) {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { generateMockOrgRepos } = await import('../__mocks__/mockOrgs.js')
            setOrgRepos(generateMockOrgRepos(orgLogin))
            setSelectedOrg(orgLogin)
            return
        }
        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_BASE}/orgs/${orgLogin}/repos?page=${pageNum}&per_page=100`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setOrgRepos(data.repos || [])
                setSelectedOrg(orgLogin)
            } else if (r.status === 401) {
                return
            }
        } catch (e) {
            if (e instanceof ApiError && e.type === ErrorType.AUTHENTICATION) return
            console.error('fetchOrgRepos error:', e)
            setTimedError('Failed to load organization repositories')
        }
    }

    /**
     * Patch a single repo inside the loaded org-scoped list without refetching.
     * Matches by id first, then by full_name. Mirrors patchRepoLocal in useRepos
     * so RepoDetail mutations can stay in sync regardless of which list the
     * user is currently viewing.
     */
    const patchOrgRepoLocal = useCallback((updatedRepo) => {
        if (!updatedRepo) return
        setOrgRepos(prev => prev.map(r => {
            const sameId = updatedRepo.id != null && r.id === updatedRepo.id
            const sameName = !sameId && updatedRepo.full_name && r.full_name === updatedRepo.full_name
            return (sameId || sameName) ? { ...r, ...updatedRepo } : r
        }))
    }, [])

    /**
     * Fetch dashboard statistics
     */
    const fetchStats = useCallback(async (org = '') => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { generateMockStats } = await import('../__mocks__/mockOrgs.js')
            setStats(generateMockStats(org))
            return
        }
        if (isSessionExpired()) return
        try {
            const url = org
                ? `${API_BASE}/stats?org=${org}`
                : `${API_BASE}/stats`

            // Get cache settings from localStorage (with safety for corrupted data)
            let cacheSettings = { enabled: true, ttl: 5 }
            try {
                const saved = localStorage.getItem('cache-settings')
                if (saved) cacheSettings = JSON.parse(saved)
            } catch {
                // Corrupted localStorage data, use defaults
            }
            const headers = {
                'x-cache-ttl': cacheSettings.enabled ? cacheSettings.ttl.toString() : '0'
            }

            const r = await fetch(url, { credentials: 'include', headers })
            if (r.ok) {
                const data = await safeParseJson(r)
                setStats(data)
            } else if (r.status === 401) {
                return
            } else {
                // Non-OK status, ignore silently
            }
        } catch (e) {
            if (e instanceof ApiError && e.type === ErrorType.AUTHENTICATION) return
            console.error('fetchStats error:', e)
            setTimedError('Failed to load dashboard statistics')
        }
    }, [setTimedError])

    // Load orgs + stats on login, then re-fetch stats (scoped to the org)
    // only when the user explicitly switches org. Consolidated from two
    // effects that each fired a stats fetch on login — a redundant double
    // request every time `user` transitioned to truthy.
    const wasLoggedInRef = useRef(false)
    useEffect(() => {
        const mocksEnabled = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'
        const isLoggedIn = mocksEnabled || !!user
        const justLoggedIn = isLoggedIn && !wasLoggedInRef.current
        wasLoggedInRef.current = isLoggedIn

        if (!isLoggedIn) return

        if (justLoggedIn) {
            Promise.resolve().then(() => {
                if (user) fetchOrgs()
                fetchStats()
            })
            return
        }

        // Not the login transition — an explicit org switch (or a
        // mock-mode selectedOrg change): scoped stats refetch only.
        Promise.resolve().then(() => fetchStats(selectedOrg))
    }, [user, selectedOrg, fetchOrgs, fetchStats])

    /**
     * Fetch activity feed for a user
     */
    const fetchActivity = useCallback(async (username) => {
        if (!username) return

        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { generateMockActivity } = await import('../__mocks__/mockOrgs.js')
            setActivity(generateMockActivity())
            return
        }

        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_BASE}/activity?username=${username}`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setActivity(Array.isArray(data) ? data.slice(0, 20) : [])
            } else if (r.status === 401) {
                return
            }
        } catch (e) {
            if (e instanceof ApiError && e.type === ErrorType.AUTHENTICATION) return
            console.error('fetchActivity error:', e)
            setTimedError('Failed to load activity feed')
        }
    }, [setTimedError])

    // Auto-fetch activity when user is loaded
    useEffect(() => {
        if (user?.login) {
            Promise.resolve().then(() => fetchActivity(user.login))
        }
    }, [user, fetchActivity])

    return {
        orgs,
        selectedOrg,
        setSelectedOrg,
        orgRepos,
        stats,
        activity,
        error,
        fetchOrgs,
        fetchOrgRepos,
        fetchStats,
        fetchActivity,
        patchOrgRepoLocal
    }
}
