import { useState, useEffect, useCallback } from 'react'
import { apiCall } from '../../../utils/api'

const AI_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Pure function: compute a heuristic risk score (0–5) for a file.
 */
export function heuristicRisk(file) {
    const { filename, additions = 0, deletions = 0 } = file
    let score = 0

    if (/auth|secret|token|crypt|password|session|middleware/i.test(filename)) score += 3
    if (/migrat|schema|\.sql$/i.test(filename)) score += 2
    if (additions + deletions > 200) score += 2
    if (additions + deletions > 500) score += 1
    if (/\.lock$|\.generated\.|vendor\/|node_modules|\.min\./i.test(filename)) score -= 3
    if (/\.config\.|\.env\.example|\.eslintrc/i.test(filename)) score -= 1

    return Math.max(0, Math.min(5, score))
}

/**
 * Sort files descending by AI risk (if available) or heuristic score.
 * @param {Array} files - array of file objects with at least { filename }
 * @param {Object} aiFileRisks - plain object { filename: score } (optional)
 * @returns {Array} sorted copy
 */
export function sortFilesByRisk(files, aiFileRisks = {}) {
    return [...files].sort((a, b) => {
        const scoreA = aiFileRisks[a.filename] ?? heuristicRisk(a)
        const scoreB = aiFileRisks[b.filename] ?? heuristicRisk(b)
        return scoreB - scoreA
    })
}

// Mirror the bounds in aiReviewSummarySchema (server/lib/validators.js). Zod
// rejects the whole request when any is exceeded, so a 900-file PR or one
// enormous patch would 400 the entire summary rather than degrade. Clamping
// here keeps big PRs working with slightly less context.
export const MAX_MANIFEST_FILES = 500
export const MAX_PATCH_FILES = 30
export const MAX_PATCH_CHARS = 120000

/**
 * Build the POST /api/ai/review-summary body.
 *
 * Pure and exported so tests/ai-request-contracts.test.js can run the real
 * output through the real server schema — mocking apiCall is what let this
 * payload drift out of contract and 400 on every call.
 *
 * @returns {{fileManifest: Array, topFilePatches: Array, prMetadata: Object}}
 */
export function buildReviewSummaryPayload({ files, owner, repo, pullNumber, title }) {
    const fileManifest = files.slice(0, MAX_MANIFEST_FILES).map(
        ({ filename, additions, deletions, status }) => ({ filename, additions, deletions, status })
    )

    // The schema takes objects, not a joined blob: the handler reads
    // `f.filename` / `f.patch` off each entry to build the prompt.
    const topFilePatches = sortFilesByRisk(files, {})
        .filter((f) => f.patch)
        .slice(0, MAX_PATCH_FILES)
        .map(({ filename, patch }) => ({ filename, patch: patch.slice(0, MAX_PATCH_CHARS) }))

    const totals = files.reduce(
        (acc, f) => {
            acc.additions += f.additions || 0
            acc.deletions += f.deletions || 0
            return acc
        },
        { additions: 0, deletions: 0 }
    )

    return {
        fileManifest,
        topFilePatches,
        // `repo` and `number` feed the server's audit record; omitting them
        // logged every review summary against an undefined repo.
        prMetadata: {
            title: title || `PR #${pullNumber}`,
            number: Number(pullNumber),
            repo: `${owner}/${repo}`,
            additions: totals.additions,
            deletions: totals.deletions,
        },
    }
}

function getCacheKey(owner, repo, pullNumber, headSha) {
    return `pr-review-ai-${owner}-${repo}-${pullNumber}-${headSha}`
}

function loadCachedSummary(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (Date.now() - parsed._savedAt > AI_CACHE_TTL_MS) {
            localStorage.removeItem(cacheKey)
            return null
        }
        return parsed.summary
    } catch {
        return null
    }
}

function saveCachedSummary(cacheKey, summary) {
    try {
        localStorage.setItem(cacheKey, JSON.stringify({ summary, _savedAt: Date.now() }))
    } catch {
        // ignore quota errors
    }
}

/**
 * Hook for AI-powered PR review summary.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string|number} pullNumber
 * @param {string} headSha - current head commit SHA (used as cache key)
 * @param {Array} files - array of PR file objects
 */
export function useReviewAI(owner, repo, pullNumber, headSha, files, options = {}) {
    const { enabled = true, title = '' } = options
    const [summary, setSummary] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const fetchSummary = useCallback(async () => {
        if (!enabled) return
        if (!owner || !repo || !pullNumber || !headSha || !files?.length) return

        const cacheKey = getCacheKey(owner, repo, pullNumber, headSha)

        // Check cache first
        const cached = loadCachedSummary(cacheKey)
        if (cached) {
            setSummary(cached)
            return
        }

        setLoading(true)
        setError(null)

        try {
            // apiCall injects+rotates the CSRF token and, on failure, throws an
            // ApiError carrying .status and .code (mapped by AIErrorState to a CTA).
            const result = await apiCall('/api/ai/review-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    buildReviewSummaryPayload({ files, owner, repo, pullNumber, title })
                ),
            })
            const summaryData = result.summary ?? result

            saveCachedSummary(cacheKey, summaryData)
            setSummary(summaryData)
        } catch (e) {
            // Preserve the full err so AIErrorState can map .code → CTA.
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [enabled, owner, repo, pullNumber, headSha, files, title])

    // Fetch on mount / when headSha/files change.
    // fetchSummary is stable (useCallback) and only sets state after awaited fetch resolves.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see note above.
        fetchSummary()
    }, [fetchSummary])

    return { summary, loading, error, retry: fetchSummary }
}
