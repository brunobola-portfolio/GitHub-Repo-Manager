/*
 * GitHub Repo Manager
 * GitHub data and actions hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState, useEffect, useCallback } from 'react'
import {
    safeParseJson,
    parseLinkHeaderTotal,
    fetchWithRetry,
    ApiError,
    ErrorType
} from '../utils/api'
import { MOCK_MODE, API_ENDPOINTS, PAGINATION } from '../config'

/**
 * Generate mock data for development
 */
function generateMockData(page = 1, perPage = 30) {
    const totalRepos = 87 // Simulate having many repos
    const totalPages = Math.ceil(totalRepos / perPage)
    const startIndex = (page - 1) * perPage
    const endIndex = Math.min(startIndex + perPage, totalRepos)

    const mockRepos = []
    for (let i = startIndex; i < endIndex; i++) {
        mockRepos.push({
            id: i + 1,
            name: `project-${i + 1}`,
            full_name: `dev-user/project-${i + 1}`,
            description: i % 2 === 0 ? `Description for project ${i + 1}` : null,
            fork: i % 3 === 0,
            private: i % 4 === 0,
            owner: { login: 'dev-user' },
            html_url: `https://github.com/dev-user/project-${i + 1}`,
            updated_at: new Date(Date.now() - i * 86400000).toISOString(),
            stargazers_count: Math.floor(Math.random() * 100),
            language: ['JavaScript', 'TypeScript', 'Python', 'Go', null][i % 5],
        })
    }

    return { repos: mockRepos, totalPages }
}

/**
 * Get user-friendly error info based on error type
 */
function getErrorInfo(error) {
    if (error instanceof ApiError) {
        return {
            type: error.type,
            message: error.userMessage,
            isRetryable: error.isRetryable,
            status: error.status
        }
    }

    // Handle non-ApiError errors
    if (!navigator.onLine) {
        return {
            type: ErrorType.OFFLINE,
            message: 'You appear to be offline. Please check your connection.',
            isRetryable: true,
            status: null
        }
    }

    return {
        type: ErrorType.UNKNOWN,
        message: error?.message || 'An unexpected error occurred.',
        isRetryable: true,
        status: null
    }
}

export function useGitHub() {
    const [user, setUser] = useState(null)
    const [repos, setRepos] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [errorInfo, setErrorInfo] = useState(null)
    const [message, setMessage] = useState('')
    const [selectedIds, setSelectedIds] = useState(new Set())
    const [page, setPage] = useState(1)
    const [perPage, setPerPage] = useState(PAGINATION.defaultPerPage)
    const [totalPages, setTotalPages] = useState(null)
    const [isPerforming, setIsPerforming] = useState(false)
    const [results, setResults] = useState([])
    const [retryCount, setRetryCount] = useState(0)

    // Initialize with mock data or fetch user
    useEffect(() => {
        if (MOCK_MODE) {
            const mockUser = {
                login: 'dev-user',
                avatar_url: 'https://github.com/ghost.png',
                name: 'Development User'
            }
            const { repos: mockRepos, totalPages: mockTotalPages } = generateMockData(1, perPage)
            setUser(mockUser)
            setRepos(mockRepos)
            setTotalPages(mockTotalPages)
            return
        }
        fetchUser()
    }, [perPage])

    // Fetch repos when page or perPage changes (non-mock mode).
    // When unauthenticated, avoid calling the repos API and instead
    // clear the current list so the UI can show an auth empty state.
    useEffect(() => {
        if (MOCK_MODE) {
            const { repos: mockRepos, totalPages: mockTotalPages } = generateMockData(page, perPage)
            setRepos(mockRepos)
            setTotalPages(mockTotalPages)
            return
        }

        if (!user) {
            setRepos([])
            setTotalPages(null)
            return
        }

        fetchRepos(page, perPage)
    }, [page, perPage, user])

    /**
     * Fetch current user from API with retry logic
     */
    async function fetchUser() {
        setLoading(true)
        setError(null)
        setErrorInfo(null)

        try {
            const r = await fetchWithRetry(API_ENDPOINTS.user, { credentials: 'include' })
            const parsed = await safeParseJson(r)

            if (parsed && parsed.__rawText) {
                setUser(null)
                setError('Invalid response')
                setErrorInfo({
                    type: ErrorType.SERVER,
                    message: 'Unexpected response from server. Please try again.',
                    isRetryable: true
                })
                setMessage('Unexpected response from server.')
                return
            }

            setUser(parsed)
            setMessage('')
            setRetryCount(0)
        } catch (e) {
            console.error('fetchUser', e)
            const info = getErrorInfo(e)
            setUser(null)
            setError(info.message)
            setErrorInfo(info)
            setMessage(info.message)
        } finally {
            setLoading(false)
        }
    }

    /**
     * Fetch repositories from API with pagination and retry logic
     */
    async function fetchRepos(pageToLoad = 1, per = 30) {
        setLoading(true)
        setError(null)
        setErrorInfo(null)

        try {
            const url = `${API_ENDPOINTS.repos}?page=${pageToLoad}&per_page=${per}`
            const r = await fetchWithRetry(url, { credentials: 'include' })
            const parsed = await safeParseJson(r)

            // Handle response format: { repos, page, totalPages } or direct array
            if (parsed && Array.isArray(parsed.repos)) {
                setRepos(parsed.repos)
                if (parsed.totalPages) setTotalPages(parsed.totalPages)
            } else if (Array.isArray(parsed)) {
                setRepos(parsed)
                // Parse pagination from Link header (GitHub direct API)
                const link = r.headers?.get('link')
                if (link) {
                    const parsedTotal = parseLinkHeaderTotal(link)
                    if (parsedTotal) setTotalPages(parsedTotal)
                } else {
                    setTotalPages(null)
                }
            } else {
                setRepos([])
            }

            setMessage('')
            setPage(pageToLoad)
            setPerPage(per)
            setRetryCount(0)
        } catch (e) {
            console.error('fetchRepos', e)
            const info = getErrorInfo(e)
            setError(info.message)
            setErrorInfo(info)
            setMessage(info.message)
            setRepos([])
        } finally {
            setLoading(false)
        }
    }

    const toggleSelect = useCallback((id) => {
        setSelectedIds(prev => {
            const copy = new Set(prev)
            if (copy.has(id)) copy.delete(id)
            else copy.add(id)
            return copy
        })
    }, [])

    const selectRepos = useCallback((reposToSelect) => {
        const targetRepos = Array.isArray(reposToSelect) ? reposToSelect : repos
        setSelectedIds(prev => {
            const copy = new Set(prev)
            targetRepos.forEach(r => copy.add(r.id))
            return copy
        })
    }, [repos])

    const deselectRepos = useCallback((reposToDeselect) => {
        const targetRepos = Array.isArray(reposToDeselect) ? reposToDeselect : repos
        setSelectedIds(prev => {
            const copy = new Set(prev)
            targetRepos.forEach(r => copy.delete(r.id))
            return copy
        })
    }, [repos])

    const invertSelection = useCallback((reposToInvert) => {
        const targetRepos = Array.isArray(reposToInvert) ? reposToInvert : repos
        setSelectedIds(prev => {
            const copy = new Set(prev)
            targetRepos.forEach(r => {
                if (copy.has(r.id)) copy.delete(r.id)
                else copy.add(r.id)
            })
            return copy
        })
    }, [repos])

    const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

    /**
     * Perform bulk action on repositories
     * @param {string} action - Action type: 'visibility', 'transfer', 'mirror'
     * @param {string[]|null} items - Specific repo full_names, or null to use selectedIds
     * @param {string} org - Target organization for transfer/mirror
     * @param {object} options - Additional options like { makePublic: true }
     */
    async function performAction(action, items = null, org = '', options = {}) {
        // Get target repos
        const repoNames = items || Array.from(selectedIds).map(id => {
            const r = repos.find(x => x.id === id)
            return r ? r.full_name : null
        }).filter(Boolean)

        if (repoNames.length === 0) {
            const msg = 'Select at least 1 repository'
            setMessage(msg)
            return { success: false, message: msg, skipped: true }
        }

        // Mock mode simulation
        if (MOCK_MODE) {
            setIsPerforming(true)
            setMessage(`Processing ${repoNames.length} repositories...`)
            await new Promise(r => setTimeout(r, 1500))

            const actionLabels = {
                visibility: options.makePublic ? 'Made public' : 'Made private',
                transfer: `Transferred to ${org || 'organization'}`,
                mirror: `Created mirror in ${org || 'organization'}`
            }
            const msg = `${actionLabels[action] || action}: ${repoNames.length} repositories`

            const entry = {
                at: new Date().toISOString(),
                action,
                message: msg,
                count: repoNames.length,
                success: true
            }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            setIsPerforming(false)
            clearSelection()
            return {
                success: true,
                message: msg,
                action,
                count: repoNames.length,
                results: [],
            }
        }

        // Real API call with retry
        setIsPerforming(true)
        setMessage(`Processing ${repoNames.length} repositories...`)

        try {
            const body = {
                repos: repoNames,
                toOrg: org,
                ...options
            }

            const endpoint = API_ENDPOINTS[action] || `${API_ENDPOINTS.repos.replace('/repos', '')}/${action}`
            const resp = await fetchWithRetry(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, { maxRetries: 2 })

            const parsed = await safeParseJson(resp)
            const apiResults = Array.isArray(parsed?.results) ? parsed.results : []
            const failed = apiResults.filter(r => r && r.success === false)
            const successCount = apiResults.length
                ? apiResults.filter(r => r && r.success !== false).length
                : repoNames.length

            const msg = parsed?.message
                || (failed.length
                    ? `Completed with ${successCount} success${successCount === 1 ? '' : 'es'} and ${failed.length} failure${failed.length === 1 ? '' : 's'}`
                    : `Operation completed for ${successCount} repositories`)

            const entry = {
                at: new Date().toISOString(),
                action,
                message: msg,
                count: repoNames.length,
                success: failed.length === 0,
                failedCount: failed.length || 0,
            }

            setMessage(msg)
            setResults(prev => [entry, ...prev])

            // Refresh repos list
            await fetchRepos(page, perPage)
            clearSelection()

            return {
                success: failed.length === 0,
                message: msg,
                action,
                count: repoNames.length,
                results: apiResults,
                failedCount: failed.length || 0,
                successCount,
                raw: parsed,
            }
        } catch (e) {
            console.error('performAction', e)
            const info = getErrorInfo(e)
            setMessage(info.message)
            setErrorInfo(info)
            const entry = {
                at: new Date().toISOString(),
                action,
                message: info.message,
                success: false,
                errorType: info.type
            }
            setResults(prev => [entry, ...prev])
            return {
                success: false,
                message: info.message,
                action,
                error: info,
            }
        } finally {
            setIsPerforming(false)
        }
    }

    /**
     * Refresh the current page
     */
    const refresh = useCallback(() => {
        if (MOCK_MODE) {
            const { repos: mockRepos, totalPages: mockTotalPages } = generateMockData(page, perPage)
            setRepos(mockRepos)
            setTotalPages(mockTotalPages)
            return
        }

        if (!user) {
            // Avoid unnecessary API calls when the user is not authenticated.
            // This keeps the console free of repeated 401 errors and lets the
            // UI show a clear authentication-required empty state instead.
            setRepos([])
            setTotalPages(null)
            setMessage('Authentication required. Login with GitHub to load your repositories.')
            return
        }

        fetchRepos(page, perPage)
    }, [page, perPage, user])

    // ============ ORGANIZATIONS ============
    const [orgs, setOrgs] = useState([])
    const [selectedOrg, setSelectedOrg] = useState(null)
    const [orgRepos, setOrgRepos] = useState([])
    const [stats, setStats] = useState(null)

    /**
     * Fetch user's organizations
     */
    async function fetchOrgs() {
        if (MOCK_MODE) {
            setOrgs([
                { login: 'org-portfolio', avatar_url: 'https://github.com/ghost.png', public_repos: 12, total_private_repos: 3 },
                { login: 'org-forks', avatar_url: 'https://github.com/ghost.png', public_repos: 8, total_private_repos: 0 },
                { login: 'org-experiments', avatar_url: 'https://github.com/ghost.png', public_repos: 5, total_private_repos: 7 },
            ])
            return
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/orgs`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setOrgs(Array.isArray(data) ? data : [])
            }
        } catch (e) {
            console.error('fetchOrgs', e)
        }
    }

    /**
     * Fetch repos for a specific organization
     */
    async function fetchOrgRepos(orgLogin, pageNum = 1) {
        if (MOCK_MODE) {
            const mockOrgRepos = Array.from({ length: 15 }, (_, i) => ({
                id: 1000 + i,
                name: `${orgLogin}-repo-${i + 1}`,
                full_name: `${orgLogin}/${orgLogin}-repo-${i + 1}`,
                description: `Repository ${i + 1} in ${orgLogin}`,
                fork: i % 4 === 0,
                private: i % 3 === 0,
                owner: { login: orgLogin },
                html_url: `https://github.com/${orgLogin}/${orgLogin}-repo-${i + 1}`,
                updated_at: new Date(Date.now() - i * 86400000).toISOString(),
                stargazers_count: Math.floor(Math.random() * 50),
                language: ['JavaScript', 'TypeScript', 'Python', 'Go', null][i % 5],
            }))
            setOrgRepos(mockOrgRepos)
            setSelectedOrg(orgLogin)
            return
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/orgs/${orgLogin}/repos?page=${pageNum}&per_page=100`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setOrgRepos(data.repos || [])
                setSelectedOrg(orgLogin)
            }
        } catch (e) {
            console.error('fetchOrgRepos', e)
        }
    }

    /**
     * Fetch dashboard statistics
     */
    /**
     * Fetch dashboard statistics
     */
    async function fetchStats(org = '') {
        if (MOCK_MODE) {
            setStats({
                totalRepos: org ? 15 : 87,
                publicRepos: org ? 10 : 45,
                privateRepos: org ? 5 : 42,
                forks: org ? 2 : 23,
                sources: org ? 13 : 64,
                archived: org ? 1 : 5,
                organizations: 3,
                user: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' }
            })
            return
        }
        try {
            const url = org
                ? `${API_ENDPOINTS.repos.replace('/repos', '')}/stats?org=${org}`
                : `${API_ENDPOINTS.repos.replace('/repos', '')}/stats`

            const r = await fetch(url, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setStats(data)
            }
        } catch (e) {
            console.error('fetchStats', e)
        }
    }

    // Auto-refresh stats when selectedOrg changes
    useEffect(() => {
        if (!MOCK_MODE && user) {
            fetchStats(selectedOrg)
        } else if (MOCK_MODE) {
            fetchStats(selectedOrg)
        }
    }, [selectedOrg, user])


    /**
     * Archive/unarchive repositories
     */
    async function archiveRepos(repoNames, archive = true) {
        if (!repoNames || repoNames.length === 0) {
            const msg = 'Select at least 1 repository'
            setMessage(msg)
            return { success: false, message: msg }
        }

        if (MOCK_MODE) {
            setIsPerforming(true)
            await new Promise(r => setTimeout(r, 1000))
            const msg = `${archive ? 'Archived' : 'Unarchived'} ${repoNames.length} repositories`
            const entry = { at: new Date().toISOString(), action: 'archive', message: msg, success: true }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            setIsPerforming(false)
            return { success: true, message: msg }
        }

        setIsPerforming(true)
        try {
            const resp = await fetchWithRetry(`${API_ENDPOINTS.repos.replace('/repos', '')}/archive`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: repoNames, archive })
            }, { maxRetries: 2 })
            const data = await safeParseJson(resp)
            const msg = data?.message || `${archive ? 'Archived' : 'Unarchived'} ${repoNames.length} repositories`
            const entry = { at: new Date().toISOString(), action: 'archive', message: msg, success: true }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            await fetchRepos(page, perPage)
            return { success: true, message: msg, data }
        } catch (e) {
            const info = getErrorInfo(e)
            setMessage(info.message)
            setErrorInfo(info)
            const entry = { at: new Date().toISOString(), action: 'archive', message: info.message, success: false, errorType: info.type }
            setResults(prev => [entry, ...prev])
            // Surface a simple Error so UI try/catch blocks receive a user-friendly message
            throw new Error(info.message)
        } finally {
            setIsPerforming(false)
        }
    }

    /**
     * Delete repositories (dangerous!)
     */
    async function deleteRepos(repoNames, confirmToken = 'DELETE') {
        if (!repoNames || repoNames.length === 0) {
            const msg = 'Select at least 1 repository'
            setMessage(msg)
            return { success: false, message: msg }
        }

        if (MOCK_MODE) {
            setIsPerforming(true)
            await new Promise(r => setTimeout(r, 1500))
            const msg = `Deleted ${repoNames.length} repositories`
            const entry = { at: new Date().toISOString(), action: 'delete', message: msg, success: true }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            setIsPerforming(false)
            return { success: true, message: msg }
        }

        setIsPerforming(true)
        try {
            const resp = await fetchWithRetry(`${API_ENDPOINTS.repos.replace('/repos', '')}/delete`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: repoNames, confirm: confirmToken })
            }, { maxRetries: 2 })
            const data = await safeParseJson(resp)
            const msg = data?.message || `Deleted ${repoNames.length} repositories`
            const entry = { at: new Date().toISOString(), action: 'delete', message: msg, success: true }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            await fetchRepos(page, perPage)
            clearSelection()
            return { success: true, message: msg, data }
        } catch (e) {
            const info = getErrorInfo(e)
            setMessage(info.message)
            setErrorInfo(info)
            const entry = { at: new Date().toISOString(), action: 'delete', message: info.message, success: false, errorType: info.type }
            setResults(prev => [entry, ...prev])
            throw new Error(info.message)
        } finally {
            setIsPerforming(false)
        }
    }

    /**
     * Create a new repository
     */
    async function createRepo(name, options = {}) {
        if (MOCK_MODE) {
            setIsPerforming(true)
            await new Promise(r => setTimeout(r, 1000))
            const msg = `Created repository: ${options.org ? options.org + '/' : ''}${name}`
            setMessage(msg)
            setResults(prev => [{ at: new Date().toISOString(), action: 'create', message: msg, success: true }, ...prev])
            setIsPerforming(false)
            return { success: true, message: msg }
        }

        setIsPerforming(true)
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/repos`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, ...options })
            })
            const data = await safeParseJson(r)
            if (r.ok) {
                const msg = `Created: ${data.repo?.full_name || name}`
                setMessage(msg)
                setResults(prev => [{ at: new Date().toISOString(), action: 'create', message: msg, success: true }, ...prev])
                await fetchRepos(page, perPage)
                return { success: true, repo: data.repo, message: msg }
            } else {
                const msg = data.error || 'Failed to create repository'
                setMessage(msg)
                return { success: false, error: data.error, message: msg }
            }
        } catch (e) {
            const msg = 'Error: ' + e.message
            setMessage(msg)
            return { success: false, error: e.message, message: msg }
        } finally {
            setIsPerforming(false)
        }
    }

    /**
     * Import from Azure DevOps
     */
    async function importFromAzure(azureOrg, azureProject, azureRepo, azurePat, options = {}) {
        if (MOCK_MODE) {
            setIsPerforming(true)
            setMessage('Starting Azure DevOps import...')
            await new Promise(r => setTimeout(r, 2000))
            const msg = `Import started: ${azureOrg}/${azureProject}/${azureRepo}`
            setMessage(msg)
            setResults(prev => [{ at: new Date().toISOString(), action: 'import-azure', message: msg, success: true }, ...prev])
            setIsPerforming(false)
            return { success: true, message: msg }
        }

        setIsPerforming(true)
        setMessage('Starting Azure DevOps import...')
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/import-azure`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    azureOrg,
                    azureProject,
                    azureRepo,
                    azurePat,
                    ...options
                })
            })
            const data = await safeParseJson(r)
            if (r.ok) {
                const msg = `Import started: ${data.repo?.full_name || azureRepo}`
                setMessage(msg)
                setResults(prev => [{ at: new Date().toISOString(), action: 'import-azure', message: msg, success: true }, ...prev])
                return { success: true, repo: data.repo, import: data.import, message: msg }
            } else {
                const msg = data.error || 'Import failed'
                setMessage(msg)
                setResults(prev => [{ at: new Date().toISOString(), action: 'import-azure', message: msg, success: false }, ...prev])
                return { success: false, error: data.error, message: msg }
            }
        } catch (e) {
            const msg = 'Error: ' + e.message
            setMessage(msg)
            return { success: false, error: e.message, message: msg }
        } finally {
            setIsPerforming(false)
        }
    }

    /**
     * Check import status
     */
    async function checkImportStatus(owner, repo) {
        if (MOCK_MODE) {
            return { status: 'complete' }
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/import-status/${owner}/${repo}`, { credentials: 'include' })
            return await safeParseJson(r)
        } catch (e) {
            return { status: 'error', message: e.message }
        }
    }

    // Load orgs and stats when user is loaded
    useEffect(() => {
        if (user) {
            fetchOrgs()
            fetchStats()
        }
    }, [user])



    const [activity, setActivity] = useState([])

    /**
     * Generate mock activity data
     */
    function generateMockActivity() {
        const actions = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'WatchEvent']
        const repos = ['frontend-app', 'backend-api', 'docs', 'design-system', 'mobile-app']

        return Array.from({ length: 15 }, (_, i) => {
            const type = actions[Math.floor(Math.random() * actions.length)]
            const repoName = repos[Math.floor(Math.random() * repos.length)]
            const timeOffset = Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 3) // Random time within last 3 days

            return {
                id: `evt-${i}`,
                type,
                actor: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
                repo: { name: `dev-user/${repoName}` },
                created_at: new Date(Date.now() - timeOffset).toISOString(),
                payload: {
                    commits: type === 'PushEvent' ? [{ message: 'Update documentation' }, { message: 'Fix bug in login' }] : [],
                    action: type === 'PullRequestEvent' ? 'opened' : (type === 'IssuesEvent' ? 'opened' : null),
                    issue: type === 'IssuesEvent' ? { title: 'Bug: Login fails on mobile', number: 42 } : null,
                    pull_request: type === 'PullRequestEvent' ? { title: 'Feat: Add dark mode', number: 101 } : null,
                    ref_type: type === 'CreateEvent' ? 'branch' : null,
                    ref: type === 'CreateEvent' ? 'feature/new-ui' : null
                }
            }
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    const fetchActivity = useCallback(async (username) => {
        if (!username) return

        if (MOCK_MODE) {
            setActivity(generateMockActivity())
            return
        }

        try {
            // Use backend proxy to avoid exposing token or CORS issues
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/activity?username=${username}`, { credentials: 'include' })
            if (r.ok) {
                const data = await safeParseJson(r)
                setActivity(Array.isArray(data) ? data.slice(0, 20) : [])
            }
        } catch (error) {
            console.error('Failed to fetch activity:', error)
        }
    }, [MOCK_MODE])

    useEffect(() => {
        if (user?.login) {
            fetchActivity(user.login)
        }
    }, [user, fetchActivity])

    // ============ AI FEATURES ============

    async function askAI(message, context) {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1000))
            return { message: "I am a mock AI. I can't really help you, but I look good doing it!" }
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, context }),
                credentials: 'include'
            })
            return await safeParseJson(r)
        } catch (e) {
            console.error('askAI', e)
            throw e
        }
    }

    async function suggestAI(repo) {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1500))
            return {
                suggestions: [
                    { title: "Add a License", description: "Your project is missing a license file.", type: "improvement" },
                    { title: "Improve Description", description: "Add more keywords to your description for better SEO.", type: "improvement" }
                ],
                analysis: "This is a mock analysis."
            }
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo }),
                credentials: 'include'
            })
            return await safeParseJson(r)
        } catch (e) {
            console.error('suggestAI', e)
            throw e
        }
    }

    async function generateReadmeAI(details) {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 2000))
            return { readme: "# Mock README\n\nThis is a generated readme." }
        }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/readme`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(details),
                credentials: 'include'
            })
            return await safeParseJson(r)
        } catch (e) {
            console.error('generateReadmeAI', e)
            throw e
        }
    }

    return {
        user,
        repos,
        loading,
        error,
        errorInfo,
        message,
        page,
        perPage,
        totalPages,
        selectedIds,
        isPerforming,
        results,
        toggleSelect,
        selectRepos,
        deselectRepos,
        invertSelection,
        clearSelection,
        setPage,
        setPerPage,
        refresh,
        performAction,
        createRepo,
        importFromAzure,
        checkImportStatus,
        orgs,
        selectedOrg,
        orgRepos,
        stats,
        fetchOrgRepos,
        fetchOrgs,
        fetchStats,
        activity,
        askAI,
        suggestAI,
        generateReadmeAI,
        setSelectedOrg
    }
}

