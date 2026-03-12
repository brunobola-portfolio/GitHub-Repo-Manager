import { useState, useCallback } from 'react'

const API_BASE = '/api/repos'

async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        const err = new Error(body?.error || `API error: ${res.status}`)
        err.status = res.status
        throw err
    }
    return res.json()
}

export function useRepoDetail(owner, repo) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const base = `${API_BASE}/${owner}/${repo}`

    const withLoading = useCallback(async (fn) => {
        setLoading(true)
        setError(null)
        try {
            const result = await fn()
            return result
        } catch (e) {
            setError(e.message)
            throw e
        } finally {
            setLoading(false)
        }
    }, [])

    // ---- Repo Details ----
    const fetchRepo = useCallback(() =>
        withLoading(() => apiFetch(base)), [base, withLoading])

    const updateRepo = useCallback((updates) =>
        withLoading(() => apiFetch(base, { method: 'PATCH', body: JSON.stringify(updates) })),
        [base, withLoading])

    const updateTopics = useCallback((names) =>
        withLoading(() => apiFetch(`${base}/topics`, { method: 'PUT', body: JSON.stringify({ names }) })),
        [base, withLoading])

    // ---- README ----
    const fetchReadme = useCallback(() =>
        apiFetch(`${base}/readme`), [base])

    // ---- Branches ----
    const fetchBranches = useCallback(() =>
        apiFetch(`${base}/branches`), [base])

    const fetchBranch = useCallback((branch) =>
        apiFetch(`${base}/branches/${encodeURIComponent(branch)}`), [base])

    const createBranch = useCallback((branchName, sha) =>
        withLoading(() => apiFetch(`${base}/branches`, {
            method: 'POST', body: JSON.stringify({ branch: branchName, sha })
        })), [base, withLoading])

    const deleteBranch = useCallback((branch) =>
        withLoading(() => apiFetch(`${base}/branches/${encodeURIComponent(branch)}`, { method: 'DELETE' })),
        [base, withLoading])

    const fetchBranchProtection = useCallback((branch) =>
        apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`), [base])

    const updateBranchProtection = useCallback((branch, rules) =>
        withLoading(() => apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`, {
            method: 'PUT', body: JSON.stringify(rules)
        })), [base, withLoading])

    const deleteBranchProtection = useCallback((branch) =>
        withLoading(() => apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`, { method: 'DELETE' })),
        [base, withLoading])

    // ---- Releases ----
    const fetchReleases = useCallback(() =>
        apiFetch(`${base}/releases`), [base])

    const createRelease = useCallback((data) =>
        withLoading(() => apiFetch(`${base}/releases`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    const deleteRelease = useCallback((releaseId) =>
        withLoading(() => apiFetch(`${base}/releases/${releaseId}`, { method: 'DELETE' })),
        [base, withLoading])

    // ---- Issues ----
    const fetchIssues = useCallback((params = {}) => {
        const query = new URLSearchParams(params).toString()
        return apiFetch(`${base}/issues${query ? '?' + query : ''}`)
    }, [base])

    const fetchIssue = useCallback((number) =>
        apiFetch(`${base}/issues/${number}`), [base])

    const fetchIssueComments = useCallback((number) =>
        apiFetch(`${base}/issues/${number}/comments`), [base])

    const createIssue = useCallback((data) =>
        withLoading(() => apiFetch(`${base}/issues`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    const updateIssue = useCallback((number, data) =>
        withLoading(() => apiFetch(`${base}/issues/${number}`, { method: 'PATCH', body: JSON.stringify(data) })),
        [base, withLoading])

    const commentOnIssue = useCallback((number, body) =>
        withLoading(() => apiFetch(`${base}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })),
        [base, withLoading])

    // ---- Pull Requests ----
    const fetchPulls = useCallback((params = {}) => {
        const query = new URLSearchParams(params).toString()
        return apiFetch(`${base}/pulls${query ? '?' + query : ''}`)
    }, [base])

    const fetchPull = useCallback((number) =>
        apiFetch(`${base}/pulls/${number}`), [base])

    const fetchPullReviews = useCallback((number) =>
        apiFetch(`${base}/pulls/${number}/reviews`), [base])

    const fetchPullFiles = useCallback((number) =>
        apiFetch(`${base}/pulls/${number}/files`), [base])

    const createPull = useCallback((data) =>
        withLoading(() => apiFetch(`${base}/pulls`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    const mergePull = useCallback((number, data = {}) =>
        withLoading(() => apiFetch(`${base}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify(data) })),
        [base, withLoading])

    const updatePull = useCallback((number, data) =>
        withLoading(() => apiFetch(`${base}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify(data) })),
        [base, withLoading])

    // ---- Webhooks ----
    const fetchWebhooks = useCallback(() =>
        apiFetch(`${base}/hooks`), [base])

    const createWebhook = useCallback((data) =>
        withLoading(() => apiFetch(`${base}/hooks`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    const updateWebhook = useCallback((hookId, data) =>
        withLoading(() => apiFetch(`${base}/hooks/${hookId}`, { method: 'PATCH', body: JSON.stringify(data) })),
        [base, withLoading])

    const deleteWebhook = useCallback((hookId) =>
        withLoading(() => apiFetch(`${base}/hooks/${hookId}`, { method: 'DELETE' })),
        [base, withLoading])

    const pingWebhook = useCallback((hookId) =>
        withLoading(() => apiFetch(`${base}/hooks/${hookId}/pings`, { method: 'POST' })),
        [base, withLoading])

    // ---- Labels ----
    const fetchLabels = useCallback(() =>
        apiFetch(`${base}/labels`), [base])

    const createLabel = useCallback((data) =>
        withLoading(() => apiFetch(`${base}/labels`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    const deleteLabel = useCallback((name) =>
        withLoading(() => apiFetch(`${base}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' })),
        [base, withLoading])

    // ---- Commits ----
    const fetchCommits = useCallback((params = {}) => {
        const query = new URLSearchParams(params).toString()
        return apiFetch(`${base}/commits${query ? '?' + query : ''}`)
    }, [base])

    const compareBranches = useCallback((basehead) =>
        apiFetch(`${base}/compare/${encodeURIComponent(basehead)}`), [base])

    // ---- Contents ----
    const fetchContents = useCallback((path = '') => {
        const query = path ? `?path=${encodeURIComponent(path)}` : ''
        return apiFetch(`${base}/contents${query}`)
    }, [base])

    // ---- Collaborators ----
    const fetchCollaborators = useCallback(() =>
        apiFetch(`${base}/collaborators`), [base])

    const addCollaborator = useCallback((username, permission = 'push') =>
        withLoading(() => apiFetch(`${base}/collaborators/${username}`, {
            method: 'PUT', body: JSON.stringify({ permission })
        })), [base, withLoading])

    // ---- Actions ----
    const fetchWorkflows = useCallback(() =>
        apiFetch(`${base}/actions/workflows`), [base])

    const fetchRuns = useCallback(() =>
        apiFetch(`${base}/actions/runs`), [base])

    // ---- Community Health ----
    const fetchCommunityHealth = useCallback(() =>
        apiFetch(`${base}/community-health`), [base])

    // ---- Fork ----
    const forkRepo = useCallback((data = {}) =>
        withLoading(() => apiFetch(`${base}/forks`, { method: 'POST', body: JSON.stringify(data) })),
        [base, withLoading])

    return {
        loading, error,
        // Repo
        fetchRepo, updateRepo, updateTopics,
        // README
        fetchReadme,
        // Branches
        fetchBranches, fetchBranch, createBranch, deleteBranch,
        fetchBranchProtection, updateBranchProtection, deleteBranchProtection,
        // Releases
        fetchReleases, createRelease, deleteRelease,
        // Issues
        fetchIssues, fetchIssue, fetchIssueComments, createIssue, updateIssue, commentOnIssue,
        // Pull Requests
        fetchPulls, fetchPull, fetchPullReviews, fetchPullFiles, createPull, mergePull, updatePull,
        // Webhooks
        fetchWebhooks, createWebhook, updateWebhook, deleteWebhook, pingWebhook,
        // Labels
        fetchLabels, createLabel, deleteLabel,
        // Commits
        fetchCommits, compareBranches,
        // Contents
        fetchContents,
        // Collaborators
        fetchCollaborators, addCollaborator,
        // Actions
        fetchWorkflows, fetchRuns,
        // Community Health
        fetchCommunityHealth,
        // Fork
        forkRepo
    }
}
