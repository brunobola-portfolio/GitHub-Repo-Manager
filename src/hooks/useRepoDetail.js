import { useMemo } from 'react'
import { fetchWithRetry } from '../utils/api'
import { API_BASE } from '../config'

// This hook's own request base — `/api/repos` under the app's configured
// API_BASE — distinct in MEANING from utils/api's `apiCall`/`fetchWithRetry`,
// which take a full path. Named `REPOS_BASE` (not `API_BASE`) so it no longer
// shadows the config export of the same name with a different meaning.
const REPOS_BASE = `${API_BASE}/repos`

// Re-shape fetchWithRetry's ApiError into the plain Error{status,code} this
// hook's 60+ call sites have always expected, so none of them need to change
// to gain CSRF header injection, the 403 csrf_invalid rotation-retry, and
// retry-on-5xx that fetchWithRetry adds over the raw `fetch` this used to do.
function unwrapApiError(err) {
    if (err?.name !== 'ApiError') return err
    const wrapped = new Error(err.data?.error || err.message || `API error: ${err.status}`)
    wrapped.status = err.status
    // Forward the optional structured code so callers can branch on a
    // stable identifier (e.g. 'GITHUB_PRO_REQUIRED') instead of regex-
    // matching the human message — which gets sanitised in production.
    const code = err.data?.code ?? err.code
    if (code) wrapped.code = code
    return wrapped
}

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
    let res
    try {
        res = await fetchWithRetry(url, { ...options, headers })
    } catch (err) {
        throw unwrapApiError(err)
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
        const base = `${REPOS_BASE}/${owner}/${repo}`

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
            // `from` is a BRANCH NAME, not a SHA: the route resolves the SHA
            // itself via GET /git/refs/heads/{from}. It has no SHA input at
            // all, so the old { branch, sha } body was rejected by the strict
            // schema on every single call.
            createBranch: (name, from) => apiFetch(`${base}/branches`, {
                method: 'POST', body: JSON.stringify(from ? { name, from } : { name })
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
                let r
                try {
                    r = await fetchWithRetry(`${base}/pulls/${number}/diff`, {})
                } catch (err) {
                    throw unwrapApiError(err)
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
