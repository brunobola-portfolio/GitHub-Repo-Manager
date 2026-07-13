import { useState, useEffect, useCallback, useRef } from 'react'

// Module-level cache so PRDetailPanel and PRReviewView share the same data.
// Key: "owner/repo/number"
const _cache = new Map()

function cacheKey(owner, repo, number) {
  return `${owner}/${repo}/${number}`
}

const EMPTY = { detail: null, files: [], reviews: [], comments: [], loading: true, error: null }

export function usePRData(api, { owner, repo, number, enabled = true } = {}) {
  const key = cacheKey(owner, repo, number)
  const [state, setState] = useState(() => _cache.get(key) ?? EMPTY)
  // Keep ref in sync so reload closure always reads latest key without re-creating
  const keyRef = useRef(key)
  keyRef.current = key

  const load = useCallback(async () => {
    if (!enabled || !owner || !repo || !number) return
    // Capture the key THIS request is for, in the closure, at request time.
    // keyRef.current is mutable and reflects whichever key the hook is
    // CURRENTLY rendering for — reading it after the awaits below (as this
    // used to) can point at a different (newer) request than the one that
    // just resolved, cross-contaminating that newer request's cache entry.
    const requestKey = cacheKey(owner, repo, number)
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const [detail, files, reviews, comments] = await Promise.all([
        api.fetchPull(number),
        api.fetchPullFiles(number),
        api.fetchPullReviews(number),
        api.fetchIssueComments(number),
      ])
      const next = { detail, files, reviews, comments, loading: false, error: null }
      _cache.set(requestKey, next)
      // Only commit to live state if this is still the request for the
      // key the hook currently represents — otherwise a late-resolving
      // stale request would overwrite a newer one's state.
      if (requestKey === keyRef.current) setState(next)
    } catch (e) {
      if (requestKey === keyRef.current) {
        setState(s => ({ ...s, loading: false, error: e?.message ?? 'Failed to load PR' }))
      }
    }
  }, [api, owner, repo, number, enabled])

  useEffect(() => {
    if (_cache.has(key)) {
      setState(_cache.get(key))
      return
    }
    load()
  }, [key, load])

  return { ...state, reload: load }
}

/** Call this after a merge/close/update to force a fresh fetch next time. */
export function invalidatePRData(owner, repo, number) {
  _cache.delete(cacheKey(owner, repo, number))
}

/** For unit tests only — resets the shared module-level cache. */
export function _clearPRDataCache() {
  _cache.clear()
}
