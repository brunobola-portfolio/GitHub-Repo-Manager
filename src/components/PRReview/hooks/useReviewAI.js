import { useState, useEffect, useCallback } from 'react'
import { getCsrfToken } from '../../../utils/api'

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
    const { enabled = true } = options
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
            // Sort all files by heuristic risk to select top 30 for patch inclusion
            const sorted = sortFilesByRisk(files, {})

            // fileManifest: metadata for all files (no patch)
            const fileManifest = files.map(({ filename, additions, deletions, changes, status }) => ({
                filename,
                additions,
                deletions,
                changes,
                status,
                riskScore: heuristicRisk({ filename, additions, deletions }),
            }))

            // topFilePatches: concatenated patch text for top 30 by heuristic
            const topFilePatches = sorted
                .slice(0, 30)
                .filter((f) => f.patch)
                .map(({ filename, patch }) => `--- ${filename} ---\n${patch}`)
                .join('\n\n')

            const totalAdditions = files.reduce((sum, f) => sum + (f.additions || 0), 0)
            const totalDeletions = files.reduce((sum, f) => sum + (f.deletions || 0), 0)

            const csrf = await getCsrfToken()
            const res = await fetch('/api/ai/review-summary', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    fileManifest,
                    topFilePatches,
                    prMetadata: {
                        title: `PR #${pullNumber}`,
                        description: '',
                        filesChanged: files.length,
                        additions: totalAdditions,
                        deletions: totalDeletions,
                    },
                }),
            })

            if (!res.ok) {
                const errBody = await res.json().catch(() => null)
                const err = new Error(errBody?.error ?? `AI request failed: ${res.status}`)
                err.status = res.status
                err.code = errBody?.code
                throw err
            }

            const result = await res.json()
            const summaryData = result.summary ?? result

            saveCachedSummary(cacheKey, summaryData)
            setSummary(summaryData)
        } catch (e) {
            // Preserve the full err so AIErrorState can map .code → CTA.
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [enabled, owner, repo, pullNumber, headSha, files])

    // Fetch on mount / when headSha/files change.
    // fetchSummary is stable (useCallback) and only sets state after awaited fetch resolves.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see note above.
        fetchSummary()
    }, [fetchSummary])

    return { summary, loading, error, retry: fetchSummary }
}
