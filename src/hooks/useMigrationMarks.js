import { useEffect, useState, useCallback } from 'react'

// Marks are decorative provenance badges fetched once per repo card/detail.
// Without a backend session (frontend-only demo mode, expired auth) every
// card would fire its own request and log its own 401 — pure console/network
// spam for a nice-to-have decoration. After the first 401 we stop asking for
// the rest of the session; a real login navigates/reloads, which re-arms this.
let marksUnauthorized = false

// Test seam.
export function __resetMarksAuthGateForTests() {
  marksUnauthorized = false
}

// Frontend-only demo mode has no backend session — skip the request entirely
// instead of letting every repo surface log a guaranteed 401.
const MOCK_MODE = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'

/**
 * Fetches migration marks for a given target full name (e.g. "owner/repo").
 * Returns marks sorted by created_at DESC, plus loading/error state.
 */
export function useMigrationMarksFor(targetFullName) {
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(() => !!targetFullName && !marksUnauthorized && !MOCK_MODE)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!targetFullName || marksUnauthorized || MOCK_MODE) return undefined
    let cancelled = false
    const url = `/api/migration/marks?targetFullName=${encodeURIComponent(targetFullName)}`
    fetch(url, { credentials: 'include' })
      .then(r => {
        if (r.status === 401) marksUnauthorized = true
        return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      })
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
  const [loading, setLoading] = useState(() => !!planId && !marksUnauthorized)
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!planId || marksUnauthorized) return undefined
    let cancelled = false
    fetch(`/api/migration/marks/plan/${planId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 401) marksUnauthorized = true
        return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      })
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
