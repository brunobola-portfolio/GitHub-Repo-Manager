/*
 * GitHub Repo Manager
 * Repository data, pagination, and operations hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState, useEffect, useCallback } from 'react'
import { isAbort } from '../utils/errorClassification'
import {
    safeParseJson,
    fetchWithRetry,
    parseLinkHeaderTotal,
    isSessionExpired
} from '../utils/api'
import { getErrorInfo } from '../utils/errors'
import { MOCK_MODE, API_BASE, API_ENDPOINTS, PAGINATION } from '../config'
import {
    archiveRepos as archiveReposApi,
    deleteRepos as deleteReposApi,
    performAction as performActionApi
} from '../utils/repoMutations'

// Mock repository data lives in src/__mocks__/mockRepos.js. Each callsite
// inlines `import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'`
// so Vite's static analysis can eliminate the dynamic import() in prod.
// (A module-level alias defeats cross-module constant folding and ships the
// mock chunk to dist/.)

/**
 * Hook for repository data, pagination, CRUD, and bulk operations.
 *
 * @param {object|null} user - The authenticated user object (null when logged out)
 * @returns {object} Repository state and operations
 */
export function useRepos(user) {
    const [repos, setRepos] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [errorInfo, setErrorInfo] = useState(null)
    const [message, setMessage] = useState('')
    // Pagination is URL-backed so users can bookmark / share a specific page,
    // and browser back/forward actually moves between pages instead of
    // resetting to 1. Reads `?page=` on first render; falls back to 1.
    const [page, setPageState] = useState(() => {
        if (typeof window === 'undefined') return 1
        const fromUrl = Number.parseInt(new URLSearchParams(window.location.search).get('page'), 10)
        return Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 1
    })
    const setPage = useCallback((next) => {
        setPageState(next)
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        if (!next || next === 1) params.delete('page')
        else params.set('page', String(next))
        const qs = params.toString()
        const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
        window.history.replaceState(null, '', url)
    }, [])
    // Sync state with browser back/forward: if the user navigates between
    // bookmarked pages, the URL changes via popstate and the hook follows.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onPop = () => {
            const fromUrl = Number.parseInt(new URLSearchParams(window.location.search).get('page'), 10)
            const next = Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 1
            setPageState(next)
        }
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    }, [])
    const [perPage, setPerPage] = useState(PAGINATION.defaultPerPage)
    const [totalPages, setTotalPages] = useState(null)
    const [isPerforming, setIsPerforming] = useState(false)
    const [results, setResults] = useState([])

    // Initialize with mock data (DEV + VITE_MOCK_MODE=true only)
    useEffect(() => {
        if (!(import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true')) return
        let cancelled = false
        ;(async () => {
            const { generateMockRepos } = await import('../__mocks__/mockRepos.js')
            if (cancelled) return
            const { repos: mockRepos, totalPages: mockTotalPages } = generateMockRepos(1, perPage)
            setRepos(mockRepos)
            setTotalPages(mockTotalPages)
        })()
        return () => { cancelled = true }
    }, [perPage])

    /**
     * Fetch repositories from API with pagination and retry logic
     */
    const fetchRepos = useCallback(async (pageToLoad = 1, per = 30, signal) => {
        setLoading(true)
        setError(null)
        setErrorInfo(null)

        try {
            const url = `${API_ENDPOINTS.repos}?page=${pageToLoad}&per_page=${per}`
            const r = await fetchWithRetry(url, { credentials: 'include', signal })
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
        } catch (e) {
            if (isAbort(e)) return
            const info = getErrorInfo(e)
            setError(info.message)
            setErrorInfo(info)
            setMessage(info.message)
            setRepos([])
        } finally {
            setLoading(false)
        }
    }, [setPage])

    // Fetch repos when page or perPage changes.
    // When unauthenticated, avoid calling the repos API and instead
    // clear the current list so the UI can show an auth empty state.
    useEffect(() => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            let cancelled = false
            ;(async () => {
                const { generateMockRepos } = await import('../__mocks__/mockRepos.js')
                if (cancelled) return
                const { repos: mockRepos, totalPages: mockTotalPages } = generateMockRepos(page, perPage)
                setRepos(mockRepos)
                setTotalPages(mockTotalPages)
            })()
            return () => { cancelled = true }
        }

        if (!user) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRepos([])
             
            setTotalPages(null)
            return
        }

        const controller = new AbortController()
        fetchRepos(page, perPage, controller.signal)
        return () => controller.abort()
    }, [page, perPage, user, fetchRepos])


    /**
     * Perform bulk action on repositories
     * @param {string} action - Action type: 'visibility', 'transfer', 'mirror'
     * @param {string[]|null} items - Specific repo full_names, or null to use selectedIds
     * @param {string} org - Target organization for transfer/mirror
     * @param {object} options - Additional options like { makePublic: true }
     */
    async function performAction(action, items = null, org = '', options = {}) {
        const repoNames = items || []

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
            // Selection is managed by SelectionContext, not here
            return {
                success: true,
                message: msg,
                action,
                count: repoNames.length,
                results: [],
            }
        }

        // Real API call — two-step dry-run + confirmation-token flow.
        // Delegates the wire work to the pure helper in utils/repoMutations.
        setIsPerforming(true)
        setMessage(`Processing ${repoNames.length} repositories...`)

        try {
            const parsed = await performActionApi(action, repoNames, org, options)
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
            // Selection is managed by SelectionContext, not here

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
            const info = getErrorInfo(e)
            setMessage(info.message)
            setErrorInfo(info)
            const entry = {
                at: new Date().toISOString(),
                action,
                message: info.message,
                details: info.details || null,
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
     * Patch a single repo in the local list without refetching.
     * Matches by id first, then by full_name. No-op if the repo isn't loaded
     * (e.g. user is on a different page) — the next page fetch will pick up
     * the server-side state.
     */
    const patchRepoLocal = useCallback((updatedRepo) => {
        if (!updatedRepo) return
        setRepos(prev => prev.map(r => {
            const sameId = updatedRepo.id != null && r.id === updatedRepo.id
            const sameName = !sameId && updatedRepo.full_name && r.full_name === updatedRepo.full_name
            return (sameId || sameName) ? { ...r, ...updatedRepo } : r
        }))
    }, [])

    /**
     * Refresh the current page
     */
    const refresh = useCallback(() => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            ;(async () => {
                const { generateMockRepos } = await import('../__mocks__/mockRepos.js')
                const { repos: mockRepos, totalPages: mockTotalPages } = generateMockRepos(page, perPage)
                setRepos(mockRepos)
                setTotalPages(mockTotalPages)
            })()
            return
        }

        if (!user) {
            setRepos([])
            setTotalPages(null)
            setMessage('Authentication required. Login with GitHub to load your repositories.')
            return
        }

        fetchRepos(page, perPage)
    }, [page, perPage, user, fetchRepos])

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
            const data = await archiveReposApi(repoNames, archive)
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
            const entry = { at: new Date().toISOString(), action: 'archive', message: info.message, details: info.details || null, success: false, errorType: info.type }
            setResults(prev => [entry, ...prev])
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
            const data = await deleteReposApi(repoNames, confirmToken)
            const msg = data?.message || `Deleted ${repoNames.length} repositories`
            const entry = { at: new Date().toISOString(), action: 'delete', message: msg, success: true }
            setMessage(msg)
            setResults(prev => [entry, ...prev])
            await fetchRepos(page, perPage)
            // Selection is managed by SelectionContext, not here
            return { success: true, message: msg, data }
        } catch (e) {
            const info = getErrorInfo(e)
            setMessage(info.message)
            setErrorInfo(info)
            const entry = { at: new Date().toISOString(), action: 'delete', message: info.message, details: info.details || null, success: false, errorType: info.type }
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

        if (isSessionExpired()) return { success: false, error: 'Session expired', message: 'Your session has expired. Please login again.' }
        setIsPerforming(true)
        try {
            const r = await fetchWithRetry(`${API_BASE}/repos`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, ...options })
            }, { maxRetries: 0 })
            if (r.status === 401) {
                return { success: false, error: 'Session expired', message: 'Your session has expired. Please login again.' }
            }
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

        if (isSessionExpired()) return { success: false, error: 'Session expired', message: 'Your session has expired. Please login again.' }
        setIsPerforming(true)
        setMessage('Starting Azure DevOps import...')
        try {
            const r = await fetchWithRetry(`${API_BASE}/import/azure`, {
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
            }, { maxRetries: 0 })
            if (r.status === 401) {
                return { success: false, error: 'Session expired', message: 'Your session has expired. Please login again.' }
            }
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
     * Check import status by job ID
     * @param {number|string} jobId - Migration job ID returned by importFromAzure
     */
    async function checkImportStatus(jobId) {
        if (MOCK_MODE) {
            return { status: 'complete' }
        }
        try {
            const r = await fetch(`${API_BASE}/import/status/${jobId}`, { credentials: 'include' })
            return await safeParseJson(r)
        } catch (e) {
            return { status: 'error', message: e.message }
        }
    }

    return {
        repos,
        loading,
        error,
        errorInfo,
        message,
        setMessage,
        page,
        perPage,
        totalPages,
        isPerforming,
        results,
        setPage,
        refresh,
        patchRepoLocal,
        performAction,
        fetchRepos,
        archiveRepos,
        deleteRepos,
        createRepo,
        importFromAzure,
        checkImportStatus
    }
}
