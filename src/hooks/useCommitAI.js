// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState } from 'react'
import { apiCall } from '../utils/api'
import { heuristicRisk, sortFilesByRisk } from '../components/PRReview/hooks/useReviewAI'

// A commit rarely touches more files than a PR does, but cap the patch
// payload the same way useReviewAI does for PRs — keeps the request small
// and the AI focused on the files most likely to matter.
const MAX_PATCH_FILES = 20

function getCacheKey(owner, repo, sha) {
    return `commit-ai-${owner}-${repo}-${sha}`
}

// A commit's diff never changes once made, so unlike useReviewAI's PR cache
// (re-keyed on headSha with a TTL) this cache needs no expiry — the SHA
// alone is a permanent, correct key.
function loadCachedSummary(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function saveCachedSummary(cacheKey, summary) {
    try {
        localStorage.setItem(cacheKey, JSON.stringify(summary))
    } catch {
        // ignore quota errors
    }
}

/**
 * On-demand AI summary for a single commit.
 *
 * Reuses the existing `/api/ai/review-summary` endpoint verbatim (same
 * metering/spend-cap plumbing PR review already goes through) rather than
 * adding a new route — a single commit's file manifest + patches is a
 * strict subset of what a PR review already sends. Unlike `useReviewAI`,
 * this hook does not fetch on mount: commits are browsed in much higher
 * volume than PRs are reviewed, so auto-firing an AI call for every commit
 * a user opens would be the wrong cost/value trade. Call `generate()` from
 * a button to trigger it.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} sha - commit SHA (used as the cache key)
 * @param {Array}  files - commit files, GitHub commit-files shape
 *   ({ filename, additions, deletions, status, patch })
 * @param {string} [subject] - commit subject line, used as AI context
 */
export function useCommitAI(owner, repo, sha, files, subject) {
    const [summary, setSummary] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    // Whether generate() has been called at least once — lets callers tell
    // "not asked yet" apart from "asked, still loading" / "asked, empty".
    const [hasRequested, setHasRequested] = useState(false)

    const generate = useCallback(async () => {
        if (!owner || !repo || !sha || !files?.length) return

        const cacheKey = getCacheKey(owner, repo, sha)
        const cached = loadCachedSummary(cacheKey)
        if (cached) {
            setSummary(cached)
            setHasRequested(true)
            setError(null)
            return
        }

        setHasRequested(true)
        setLoading(true)
        setError(null)

        try {
            // Sort by heuristic risk so the top-N files sent as full patches
            // are the ones most likely to matter, same selection logic PR
            // review uses.
            const sorted = sortFilesByRisk(files, {})

            const fileManifest = files.map(({ filename, additions, deletions, status }) => ({
                filename,
                additions,
                deletions,
                status,
                riskScore: heuristicRisk({ filename, additions, deletions }),
            }))

            // topFilePatches is an array of { filename, patch } — matches the
            // server's aiReviewSummarySchema shape.
            const topFilePatches = sorted
                .slice(0, MAX_PATCH_FILES)
                .filter((f) => f.patch)
                .map(({ filename, patch }) => ({ filename, patch }))

            const totalAdditions = files.reduce((sum, f) => sum + (f.additions || 0), 0)
            const totalDeletions = files.reduce((sum, f) => sum + (f.deletions || 0), 0)

            const result = await apiCall('/api/ai/review-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileManifest,
                    topFilePatches,
                    prMetadata: {
                        title: subject ? `Commit: ${subject}` : `Commit ${sha.slice(0, 7)}`,
                        repo: `${owner}/${repo}`,
                        additions: totalAdditions,
                        deletions: totalDeletions,
                    },
                }),
            })
            const summaryData = result?.summary ?? result

            saveCachedSummary(cacheKey, summaryData)
            setSummary(summaryData)
        } catch (e) {
            // Preserve the full err so AIErrorState can map .code → CTA.
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [owner, repo, sha, files, subject])

    return { summary, loading, error, hasRequested, generate }
}
