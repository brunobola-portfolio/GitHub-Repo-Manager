import { useState, useCallback, useRef } from 'react'
import { apiCall } from '../../../utils/api'
import { formatUserError } from '../../../utils/errors'

/**
 * Group an array of comments by filename into a plain object.
 * { filename: [comment, ...] }
 */
function groupCommentsByFile(comments) {
    return comments.reduce((acc, comment) => {
        const key = comment.path ?? '_general'
        if (!acc[key]) acc[key] = []
        acc[key].push(comment)
        return acc
    }, {})
}

/**
 * Data fetching hook that loads all PR data in parallel.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} pullNumber
 * @param {object} api - object containing fetch functions (from useRepoDetail)
 */
export function useReviewData(owner, repo, pullNumber, api) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [data, setData] = useState(null)

    // Store the loaded headSha so checkStaleness can compare
    const loadedHeadShaRef = useRef(null)

    const fetchAll = useCallback(async () => {
        if (!owner || !repo || !pullNumber || !api) return
        setLoading(true)
        setError(null)
        try {
            const [pr, files, rawComments, reviews] = await Promise.all([
                api.fetchPull(pullNumber),
                api.fetchPullFiles(pullNumber),
                api.fetchPullComments(pullNumber),
                api.fetchPullReviews(pullNumber),
            ])
            const comments = groupCommentsByFile(rawComments)
            const headSha = pr?.head?.sha ?? null
            loadedHeadShaRef.current = headSha
            setData({ pr, files, comments, reviews, headSha })
        } catch (e) {
            setError(formatUserError(e, { fallbackTitle: "Couldn't load PR data" }).title)
        } finally {
            setLoading(false)
        }
    }, [owner, repo, pullNumber, api])

    /**
     * Compare the current PR head SHA with what we loaded.
     * Returns { isStale, currentSha, loadedSha }
     */
    const checkStaleness = useCallback(async () => {
        if (!api) return { isStale: false }
        try {
            const currentPr = await api.fetchPull(pullNumber)
            const currentSha = currentPr?.head?.sha ?? null
            const loadedSha = loadedHeadShaRef.current
            return {
                isStale: Boolean(currentSha && loadedSha && currentSha !== loadedSha),
                currentSha,
                loadedSha,
            }
        } catch {
            return { isStale: false }
        }
    }, [api, pullNumber])

    /**
     * Submit a review to GitHub.
     * @param {{ event: string, body: string, comments: Array, commitId: string }} review
     */
    const submitReview = useCallback(async ({ event, body, comments, commitId }) => {
        return apiCall(`/api/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, body, comments, commit_id: commitId }),
        })
    }, [owner, repo, pullNumber])

    /**
     * Reply to an existing inline comment.
     * @param {number} commentId
     * @param {string} body
     */
    const replyToComment = useCallback(async (commentId, body) => {
        return apiCall(
            `/api/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${commentId}/replies`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            }
        )
    }, [owner, repo, pullNumber])

    return {
        loading,
        error,
        data,
        refetch: fetchAll,
        checkStaleness,
        submitReview,
        replyToComment,
    }
}
