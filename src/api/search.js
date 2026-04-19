import { apiCall } from '../utils/api'

/**
 * Search GitHub live (PRs, issues, repositories).
 * Returns { query, type, prs: [...], issues: [...], repos: [...] } on success.
 *
 * @param {string} query  free-text query (required, 1-256 chars)
 * @param {object} [opts]
 * @param {'all'|'pr'|'issue'|'repo'} [opts.type='all']
 * @param {number} [opts.limit=10]  1-25 items returned per bucket
 * @param {AbortSignal} [opts.signal]  aborts in-flight requests on debounce
 */
export const searchApi = {
  github: async (query, { type = 'all', limit = 10, signal } = {}) => {
    const q = (query || '').trim()
    if (!q) return { query: '', type, prs: [], issues: [], repos: [] }

    const params = new URLSearchParams({ q, type, limit: String(limit) })
    return apiCall(`/api/v1/search/github?${params.toString()}`, { signal })
  },
}
