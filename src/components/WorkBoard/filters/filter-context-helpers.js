/**
 * Non-component helpers for the Work Board filter context.
 *
 * Kept in a `.js` file (separate from the `FilterProvider` component) so that
 * React Fast Refresh stays happy — the `.jsx` sibling is allowed to export
 * only components, everything else lives here.
 */

import { createContext, useContext } from 'react'

const DEFAULT_PARAMS = { repos: '', authors: '', labels: '', age: '', snoozed: '' }

export const FilterContext = createContext({
    params: DEFAULT_PARAMS,
    availableRepos: [],
    availableAuthors: [],
    availableLabels: [],
})

export function useWorkBoardFilters() {
    return useContext(FilterContext)
}

function ageCutoffMs(bucket) {
    if (bucket === '24h') return 24 * 3600 * 1000
    if (bucket === '7d') return 7 * 24 * 3600 * 1000
    if (bucket === '30d') return 30 * 24 * 3600 * 1000
    return null
}

function csvSet(s) {
    return new Set((s || '').split(',').map(x => x.trim()).filter(Boolean))
}

/**
 * Pure filter helper — no React, no side effects. Filters an array of work
 * board items (reviews / PRs / issues / tech debt) against a set of URL-style
 * filter params. Items keep only when they match every active dimension (AND
 * across dimensions, OR within a dimension's CSV values).
 *
 * Non-array input is returned untouched so tabs can pass raw hook results
 * (including `null` / `undefined`) without guarding.
 */
export function applyFilters(items, params = {}) {
    if (!Array.isArray(items)) return items
    const repos = csvSet(params.repos)
    const authors = csvSet(params.authors)
    const labels = csvSet(params.labels)
    const cutoff = ageCutoffMs(params.age)
    return items.filter(i => {
        if (repos.size && !repos.has(i.repoFullName)) return false
        if (authors.size && i.authorLogin && !authors.has(i.authorLogin)) return false
        if (labels.size && !(i.labels || []).some(l => labels.has(l))) return false
        if (cutoff != null) {
            if (!i.openedAt) return false
            const age = Date.now() - new Date(i.openedAt).getTime()
            if (age >= cutoff) return false
        }
        return true
    })
}

export { DEFAULT_PARAMS }
