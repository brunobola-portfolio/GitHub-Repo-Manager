import { useMemo } from 'react'
import { getCsrfToken } from '../utils/api'

const API_BASE = '/api/repos'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase()

    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true' && method === 'GET') {
        const { mockRepoDetailFetch } = await import('../__mocks__/mockRepoDetail.js')
        const mocked = mockRepoDetailFetch(url)
        if (mocked !== undefined) return mocked
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    }
    if (MUTATION_METHODS.has(method) && !headers['X-CSRF-Token']) {
        try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* fall through; server will 403 */ }
    }
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        const err = new Error(body?.error || `API error: ${res.status}`)
        err.status = res.status
        // Forward the optional structured code so callers can branch on a
        // stable identifier (e.g. 'GITHUB_PRO_REQUIRED') instead of regex-
        // matching the human message — which gets sanitised in production.
        if (body?.code) err.code = body.code
        throw err
    }
    return res.json()
}

export function useRepoDetail(owner, repo) {
    // Anchor the entire api surface on `base`. Previous versions exposed
    // `loading`/`error` state and rebuilt the object whenever those flipped,
    // which silently churned the object identity on every fetch — consumers
    // keying effects on `[api]` (RepoDetail.loadRepo, useTabData) were
    // re-firing forever and flooding the network. Identity now changes only
    // when owner/repo change, which is the actual contract.
    return useMemo(() => {
        const base = `${API_BASE}/${owner}/${repo}`

        return {
            // Repo
            fetchRepo: () => apiFetch(base),
            updateRepo: (updates) => apiFetch(base, { method: 'PATCH', body: JSON.stringify(updates) }),
            updateTopics: (names) => apiFetch(`${base}/topics`, { method: 'PUT', body: JSON.stringify({ names }) }),

            // README
            fetchReadme: () => apiFetch(`${base}/readme`),

            // Branches
            fetchBranches: () => apiFetch(`${base}/branches`),
            fetchBranch: (branch) => apiFetch(`${base}/branches/${encodeURIComponent(branch)}`),
            createBranch: (branchName, sha) => apiFetch(`${base}/branches`, {
                method: 'POST', body: JSON.stringify({ branch: branchName, sha })
            }),
            deleteBranch: (branch) => apiFetch(`${base}/branches/${encodeURIComponent(branch)}`, { method: 'DELETE' }),
            fetchBranchProtection: (branch) => apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`),
            updateBranchProtection: (branch, rules) => apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`, {
                method: 'PUT', body: JSON.stringify(rules)
            }),
            deleteBranchProtection: (branch) => apiFetch(`${base}/branches/${encodeURIComponent(branch)}/protection`, { method: 'DELETE' }),

            // Releases
            fetchReleases: () => apiFetch(`${base}/releases`),
            createRelease: (data) => apiFetch(`${base}/releases`, { method: 'POST', body: JSON.stringify(data) }),
            deleteRelease: (releaseId) => apiFetch(`${base}/releases/${releaseId}`, { method: 'DELETE' }),

            // Issues
            fetchIssues: (params = {}) => {
                const query = new URLSearchParams(params).toString()
                return apiFetch(`${base}/issues${query ? '?' + query : ''}`)
            },
            fetchIssue: (number) => apiFetch(`${base}/issues/${number}`),
            fetchIssueComments: (number) => apiFetch(`${base}/issues/${number}/comments`),
            createIssue: (data) => apiFetch(`${base}/issues`, { method: 'POST', body: JSON.stringify(data) }),
            updateIssue: (number, data) => apiFetch(`${base}/issues/${number}`, { method: 'PATCH', body: JSON.stringify(data) }),
            commentOnIssue: (number, body) => apiFetch(`${base}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
            setIssueLabels: (number, labels) => apiFetch(`${base}/issues/${number}/labels`, { method: 'PUT', body: JSON.stringify({ labels }) }),
            addIssueAssignees: (number, assignees) => apiFetch(`${base}/issues/${number}/assignees`, { method: 'POST', body: JSON.stringify({ assignees }) }),
            removeIssueAssignees: (number, assignees) => apiFetch(`${base}/issues/${number}/assignees`, { method: 'DELETE', body: JSON.stringify({ assignees }) }),
            fetchAssignees: () => apiFetch(`${base}/assignees`),
            fetchIssueTimeline: (number) => apiFetch(`${base}/issues/${number}/timeline`),

            // Pull Requests
            fetchPulls: (params = {}) => {
                const query = new URLSearchParams(params).toString()
                return apiFetch(`${base}/pulls${query ? '?' + query : ''}`)
            },
            fetchPull: (number) => apiFetch(`${base}/pulls/${number}`),
            fetchPullReviews: (number) => apiFetch(`${base}/pulls/${number}/reviews`),
            fetchPullFiles: (number) => apiFetch(`${base}/pulls/${number}/files`),
            fetchPullComments: (number) => apiFetch(`${base}/pulls/${number}/comments`),
            fetchPullDiff: async (number) => {
                if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
                    return `diff --git a/src/example.jsx b/src/example.jsx\nindex abc123..def456 100644\n--- a/src/example.jsx\n+++ b/src/example.jsx\n@@ -1,5 +1,8 @@\n import React from 'react'\n+import { clsx } from 'clsx'\n \n-export function Example() {\n-  return <div>old</div>\n+export function Example({ className }) {\n+  return <div className={clsx('example', className)}>new</div>\n }`
                }
                const r = await fetch(`${base}/pulls/${number}/diff`, { credentials: 'include' })
                if (!r.ok) {
                    const err = new Error(`API error: ${r.status}`)
                    err.status = r.status
                    throw err
                }
                return r.text()
            },
            createPull: (data) => apiFetch(`${base}/pulls`, { method: 'POST', body: JSON.stringify(data) }),
            mergePull: (number, data = {}) => apiFetch(`${base}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify(data) }),
            updatePull: (number, data) => apiFetch(`${base}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify(data) }),
            submitPullReview: (number, payload) => apiFetch(`${base}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify(payload) }),

            // Webhooks
            fetchWebhooks: () => apiFetch(`${base}/hooks`),
            createWebhook: (data) => apiFetch(`${base}/hooks`, { method: 'POST', body: JSON.stringify(data) }),
            updateWebhook: (hookId, data) => apiFetch(`${base}/hooks/${hookId}`, { method: 'PATCH', body: JSON.stringify(data) }),
            deleteWebhook: (hookId) => apiFetch(`${base}/hooks/${hookId}`, { method: 'DELETE' }),
            pingWebhook: (hookId) => apiFetch(`${base}/hooks/${hookId}/pings`, { method: 'POST' }),

            // Labels
            fetchLabels: () => apiFetch(`${base}/labels`),
            createLabel: (data) => apiFetch(`${base}/labels`, { method: 'POST', body: JSON.stringify(data) }),
            deleteLabel: (name) => apiFetch(`${base}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }),

            // Commits
            fetchCommits: (params = {}) => {
                const query = new URLSearchParams(params).toString()
                return apiFetch(`${base}/commits${query ? '?' + query : ''}`)
            },
            compareBranches: (basehead) => apiFetch(`${base}/compare/${encodeURIComponent(basehead)}`),

            // Contents
            fetchContents: (path = '') => {
                const query = path ? `?path=${encodeURIComponent(path)}` : ''
                return apiFetch(`${base}/contents${query}`)
            },

            // Collaborators
            fetchCollaborators: () => apiFetch(`${base}/collaborators`),
            addCollaborator: (username, permission = 'push') => apiFetch(`${base}/collaborators/${username}`, {
                method: 'PUT', body: JSON.stringify({ permission })
            }),

            // Actions
            fetchWorkflows: () => apiFetch(`${base}/actions/workflows`),
            fetchRuns: () => apiFetch(`${base}/actions/runs`),

            // Community Health
            fetchCommunityHealth: () => apiFetch(`${base}/community-health`),

            // Fork
            forkRepo: (data = {}) => apiFetch(`${base}/forks`, { method: 'POST', body: JSON.stringify(data) }),
        }
    }, [owner, repo])
}
