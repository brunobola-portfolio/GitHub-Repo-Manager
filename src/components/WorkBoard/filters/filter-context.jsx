/**
 * Work Board filter context — provides URL-synced filter params to every tab
 * so they can filter their own rendered items via the pure `applyFilters`
 * helper (exported for unit testing without React).
 */

import { createContext, useContext, useMemo } from 'react'

const DEFAULT_PARAMS = { repos: '', authors: '', labels: '', age: '', snoozed: '' }

export const FilterContext = createContext({
    params: DEFAULT_PARAMS,
    availableRepos: [],
    availableAuthors: [],
    availableLabels: [],
})

export function FilterProvider({ params, availableRepos, availableAuthors, availableLabels, children }) {
    const value = useMemo(() => ({
        params: params || DEFAULT_PARAMS,
        availableRepos: availableRepos || [],
        availableAuthors: availableAuthors || [],
        availableLabels: availableLabels || [],
    }), [params, availableRepos, availableAuthors, availableLabels])
    return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

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
