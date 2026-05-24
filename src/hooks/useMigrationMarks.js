import { useEffect, useState, useCallback } from 'react'

/**
 * Fetches migration marks for a given target full name (e.g. "owner/repo").
 * Returns marks sorted by created_at DESC, plus loading/error state.
 */
export function useMigrationMarksFor(targetFullName) {
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(() => !!targetFullName)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!targetFullName) return undefined
    let cancelled = false
    const url = `/api/migration/marks?targetFullName=${encodeURIComponent(targetFullName)}`
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        if (cancelled) return
        setMarks(d.marks || [])
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(e)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [targetFullName])

  return { marks, loading, error }
}

/**
 * Fetches all marks for a migration plan, grouped by scope.
 * `reload()` bumps an internal token to re-trigger the fetch.
 */
export function useMarksForPlan(planId) {
  const [byScope, setByScope] = useState({ source: [], destination: [], 'git-tag': [] })
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(() => !!planId)
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!planId) return undefined
    let cancelled = false
    fetch(`/api/migration/marks/plan/${planId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        if (cancelled) return
        setByScope(d.byScope || { source: [], destination: [], 'git-tag': [] })
        setMarks(d.marks || [])
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(e)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [planId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken(t => t + 1)
  }, [])

  return { byScope, marks, loading, error, reload }
}
