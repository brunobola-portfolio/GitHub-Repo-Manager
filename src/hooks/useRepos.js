/*
 * GitHub Repo Manager
 * Repository data, pagination, and operations hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useState, useEffect, useCallback } from 'react'
import {
    safeParseJson,
    fetchWithRetry,
    parseLinkHeaderTotal,
    isSessionExpired
} from '../utils/api'
import { getErrorInfo } from '../utils/errors'
import { MOCK_MODE, API_BASE, API_ENDPOINTS, PAGINATION } from '../config'

/**
 * Generate mock repository data for development
 */
function generateMockData(page = 1, perPage = 30) {
    const mockRepoList = [
        { name: 'fintech-dashboard', lang: 'TypeScript', desc: 'Real-time financial analytics dashboard with React and D3.js' },
        { name: 'ai-analytics-platform', lang: 'Python', desc: 'Machine learning pipeline for predictive customer behavior analysis' },
        { name: 'react-component-library', lang: 'TypeScript', desc: 'Enterprise-grade UI component library based on Glassmorphism' },
        { name: 'serverless-api-gateway', lang: 'Go', desc: 'High-performance API gateway for microservices architecture' },
        { name: 'mobile-app-flutter', lang: 'Dart', desc: 'Cross-platform mobile application for inventory management' },
        { name: 'kubernetes-deploy-scripts', lang: 'HCL', desc: 'Terraform modules and Helm charts for production clusters' },
        { name: 'blockchain-wallet-core', lang: 'Rust', desc: 'Secure crypto wallet core implementation with multi-chain support' },
        { name: 'e-commerce-microservices', lang: 'Java', desc: 'Spring Boot microservices for high-scale retail platform' },
        { name: 'docs-portal', lang: 'JavaScript', desc: 'Developer documentation portal built with Docusaurus' },
        { name: 'auth-service', lang: 'Go', desc: 'Centralized authentication service with OAuth2 and OIDC support' },
        { name: 'data-lake-processor', lang: 'Python', desc: 'Spark jobs for processing daily terabyte-scale logs' },
        { name: 'ios-checkout-sdk', lang: 'Swift', desc: 'Native iOS SDK for seamless checkout integration' },
        { name: 'android-pos-terminal', lang: 'Kotlin', desc: 'Point of Sale application for Android tablets' },
        { name: 'graphql-federation', lang: 'TypeScript', desc: 'Apollo Federation gateway for unified data graph' },
        { name: 'legacy-crm-importer', lang: 'PHP', desc: 'Tools for migrating data from legacy CRM systems' },
        { name: 'design-system-tokens', lang: 'CSS', desc: 'Design tokens and assets for the corporate brand identity' },
        { name: 'devops-ci-templates', lang: 'YAML', desc: 'Standardized GitHub Actions workflows for all teams' },
        { name: 'nlp-chatbot-engine', lang: 'Python', desc: 'Natural Language Processing engine for customer support bots' },
        { name: 'web-assembly-video-editor', lang: 'C++', desc: 'Browser-based video editing core using WASM' },
        { name: 'marketing-landing-pages', lang: 'HTML', desc: 'High-conversion landing pages for marketing campaigns' }
    ]

    const totalRepos = 87
    const totalPages = Math.ceil(totalRepos / perPage)
    const startIndex = (page - 1) * perPage
    const endIndex = Math.min(startIndex + perPage, totalRepos)

    const mockRepos = []
    for (let i = startIndex; i < endIndex; i++) {
        const template = mockRepoList[i % mockRepoList.length]
        const suffix = Math.floor(i / mockRepoList.length) > 0 ? `-${Math.floor(i / mockRepoList.length) + 1}` : ''

        mockRepos.push({
            id: i + 1,
            name: `${template.name}${suffix}`,
            full_name: `dev-user/${template.name}${suffix}`,
            description: template.desc,
            fork: i % 5 === 0,
            private: i % 3 === 0,
            owner: { login: 'dev-user' },
            html_url: `https://github.com/dev-user/${template.name}${suffix}`,
            updated_at: new Date(Date.now() - i * 3600000 * (Math.random() * 10)).toISOString(),
            stargazers_count: Math.floor(Math.random() * 500) + (i * 10),
            language: template.lang,
            topics: ['react', 'typescript', 'dashboard', 'ui', 'finance'].slice(0, Math.floor(Math.random() * 5))
        })
    }

    return { repos: mockRepos, totalPages }
}

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
    const [page, setPage] = useState(1)
    const [perPage, setPerPage] = useState(PAGINATION.defaultPerPage)
    const [totalPages, setTotalPages] = useState(null)
    const [isPerforming, setIsPerforming] = useState(false)
    const [results, setResults] = useState([])

    // Initialize with mock data
    useEffect(() => {
        if (MOCK_MODE) {
            const { repos: mockRepos, totalPages: mockTotalPages } = generateMockData(1, perPage)
            setRepos(mockRepos)
            setTotalPages(mockTotalPages)
        }
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
            if (e.name === 'AbortError') return
            const info = getErrorInfo(e)
            setError(info.message)
            setErrorInfo(info)
            setMessage(info.message)
            setRepos([])
        } finally {
            setLoading(false)
        }
    }, [])

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

        // Real API call with retry (no retries for destructive/non-idempotent actions)
        setIsPerforming(true)
        setMessage(`Processing ${repoNames.length} repositories...`)

        try {
            const body = {
                repos: repoNames,
                toOrg: org,
                ...options
            }

            const destructiveActions = ['transfer', 'mirror', 'delete']
            const maxRetries = destructiveActions.includes(action) ? 0 : 2
            const endpoint = API_ENDPOINTS[action] || `${API_BASE}/${action}`
            const resp = await fetchWithRetry(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, { maxRetries })

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
            const resp = await fetchWithRetry(API_ENDPOINTS.archive, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: repoNames, archive })
            }, { maxRetries: 0 })
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
            const resp = await fetchWithRetry(API_ENDPOINTS.delete, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: repoNames, confirm: confirmToken })
            }, { maxRetries: 0 })
            const data = await safeParseJson(resp)
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
        setPerPage,
        refresh,
        performAction,
        fetchRepos,
        archiveRepos,
        deleteRepos,
        createRepo,
        importFromAzure,
        checkImportStatus
    }
}
