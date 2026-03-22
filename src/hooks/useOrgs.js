/*
 * GitHub Repo Manager
 * Organization management, stats, and activity hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState, useEffect, useCallback } from 'react'
import {
    safeParseJson,
    ApiError,
    ErrorType,
    isSessionExpired
} from '../utils/api'
import { MOCK_MODE, API_ENDPOINTS } from '../config'

/**
 * Generate mock activity data for development
 */
function generateMockActivity() {
    const actions = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'WatchEvent']
    const repos = ['fintech-dashboard', 'ai-analytics-platform', 'react-component-library', 'serverless-api-gateway', 'mobile-app-flutter']

    return Array.from({ length: 15 }, (_, i) => {
        const type = actions[Math.floor(Math.random() * actions.length)]
        const repoName = repos[Math.floor(Math.random() * repos.length)]
        const timeOffset = Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 3)

        return {
            id: `evt-${i}`,
            type,
            actor: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
            repo: { name: `dev-user/${repoName}` },
            created_at: new Date(Date.now() - timeOffset).toISOString(),
            payload: {
                commits: type === 'PushEvent' ? [{ message: 'feat: Add new dashboard widgets' }, { message: 'fix: Resolve memory leak in data processor' }] : [],
                action: type === 'PullRequestEvent' ? 'opened' : (type === 'IssuesEvent' ? 'opened' : null),
                issue: type === 'IssuesEvent' ? { title: 'Bug: Login fails on mobile devices', number: 42 } : null,
                pull_request: type === 'PullRequestEvent' ? { title: 'Feat: Implement Dark Mode Support', number: 101 } : null,
                ref_type: type === 'CreateEvent' ? 'branch' : null,
                ref: type === 'CreateEvent' ? 'feature/new-ui-components' : null
            }
        }
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

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

    /**
     * Fetch user's organizations
     */
    const fetchOrgs = useCallback(async () => {
        if (MOCK_MODE) {
            setOrgs([
                { login: 'acme-corp', avatar_url: 'https://github.com/ghost.png', public_repos: 42, total_private_repos: 15 },
                { login: 'open-source-collective', avatar_url: 'https://github.com/ghost.png', public_repos: 128, total_private_repos: 0 },
                { login: 'startup-incubator', avatar_url: 'https://github.com/ghost.png', public_repos: 5, total_private_repos: 27 },
            ])
            return
        }
        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/orgs`, { credentials: 'include' })
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
        if (MOCK_MODE) {
            const mockOrgRepos = Array.from({ length: 15 }, (_, i) => ({
                id: 1000 + i,
                name: `${orgLogin}-service-${i + 1}`,
                full_name: `${orgLogin}/${orgLogin}-service-${i + 1}`,
                description: `Core service ${i + 1} for ${orgLogin} infrastructure`,
                fork: i % 4 === 0,
                private: i % 3 === 0,
                owner: { login: orgLogin },
                html_url: `https://github.com/${orgLogin}/${orgLogin}-service-${i + 1}`,
                updated_at: new Date(Date.now() - i * 86400000).toISOString(),
                stargazers_count: Math.floor(Math.random() * 500),
                language: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'][i % 5],
            }))
            setOrgRepos(mockOrgRepos)
            setSelectedOrg(orgLogin)
            return
        }
        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/orgs/${orgLogin}/repos?page=${pageNum}&per_page=100`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setOrgRepos(data.repos || [])
                setSelectedOrg(orgLogin)
            } else if (r.status === 401) {
                return
            }
        } catch (e) {
            if (e instanceof ApiError && e.type === ErrorType.AUTHENTICATION) return
        }
    }

    /**
     * Fetch dashboard statistics
     */
    const fetchStats = useCallback(async (org = '') => {
        if (MOCK_MODE) {
            setStats({
                totalRepos: org ? 42 : 87,
                publicRepos: org ? 30 : 65,
                privateRepos: org ? 12 : 22,
                forks: org ? 5 : 18,
                sources: org ? 37 : 69,
                archived: org ? 2 : 4,
                organizations: 3,
                languages: {
                    "TypeScript": 45,
                    "Python": 30,
                    "JavaScript": 25,
                    "Go": 15,
                    "Rust": 10
                },
                user: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' }
            })
            return
        }
        if (isSessionExpired()) return
        try {
            const url = org
                ? `${API_ENDPOINTS.repos.replace('/repos', '')}/stats?org=${org}`
                : `${API_ENDPOINTS.repos.replace('/repos', '')}/stats`

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
        }
    }, [])

    // Auto-refresh stats when selectedOrg changes
    useEffect(() => {
        if (!MOCK_MODE && user) {
            fetchStats(selectedOrg)
        } else if (MOCK_MODE) {
            fetchStats(selectedOrg)
        }
    }, [selectedOrg, user, fetchStats])

    // Load orgs and stats when user is loaded
    useEffect(() => {
        if (user) {
            fetchOrgs()
            fetchStats()
        }
    }, [user, fetchOrgs, fetchStats])

    /**
     * Fetch activity feed for a user
     */
    const fetchActivity = useCallback(async (username) => {
        if (!username) return

        if (MOCK_MODE) {
            setActivity(generateMockActivity())
            return
        }

        if (isSessionExpired()) return
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/activity?username=${username}`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setActivity(Array.isArray(data) ? data.slice(0, 20) : [])
            } else if (r.status === 401) {
                return
            }
        } catch (error) {
            if (error instanceof ApiError && error.type === ErrorType.AUTHENTICATION) return
        }
    }, [])

    // Auto-fetch activity when user is loaded
    useEffect(() => {
        if (user?.login) {
            fetchActivity(user.login)
        }
    }, [user, fetchActivity])

    return {
        orgs,
        selectedOrg,
        setSelectedOrg,
        orgRepos,
        stats,
        activity,
        fetchOrgs,
        fetchOrgRepos,
        fetchStats,
        fetchActivity
    }
}
