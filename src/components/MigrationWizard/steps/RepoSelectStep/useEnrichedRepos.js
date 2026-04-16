import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * Orchestrates the Select step's data lifecycle:
 *   1. base repo list (existing endpoint),
 *   2. batched activity + LFS enrichment,
 *   3. batched conflict preview.
 *
 * Failures in enrichment do not block the list render — they degrade gracefully.
 */
export function useEnrichedRepos({ source, repos, onSetRepos, onChange, targetOrg }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tfvcWarning, setTfvcWarning] = useState('')
  const [enriching, setEnriching] = useState(false)
  const [conflictsState, setConflictsState] = useState({})
  const [fetched, setFetched] = useState(false)
  // Tracks which repo IDs have already been enriched (activity + LFS).
  // Using a ref instead of writing a private `_enriched` flag onto each repo
  // keeps the shared domain object clean for consumers downstream.
  const enrichedIdsRef = useRef(new Set())

  // ── 1. Base fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (fetched || !source.org || !source.project) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/azure/repos', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.repos) {
          if (!cancelled) setError(data.error || 'Failed to load repositories')
          return
        }
        const isTfvc = data.versionControlType === 'Tfvc'
        if (onChange) onChange({ versionControlType: isTfvc ? 'Tfvc' : null })

        const gitMapped = data.repos.map((r) => ({
          id: r.id, name: r.name, selected: false, targetName: r.name,
          visibility: 'private', description: '',
          size: r.size || 0, language: r.language || null,
          defaultBranch: r.defaultBranch || '',
          webUrl: r.webUrl || '',
          branches: r.defaultBranch ? 1 : 0,
          isDisabled: r.isDisabled || false, isFork: r.isFork || false,
          lastCommitDate: null, lastCommitAuthor: null,
          hasLfsMarker: false,
        }))

        let tfvcMapped = []
        if (isTfvc) {
          try {
            const tfvcRes = await fetch('/api/azure/tfvc/items', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                org: source.org, project: source.project,
                pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
              }),
            })
            const tfvcData = await tfvcRes.json()
            const items = (tfvcData.items || []).filter((i) => i.isFolder)
            tfvcMapped = items.map((item) => ({
              id: item.path, name: item.path.split('/').pop(),
              selected: false, targetName: item.path.split('/').pop(),
              visibility: 'private', description: '',
              size: item.size || 0, language: null, defaultBranch: '',
              branches: 0, isDisabled: false, isFork: false,
              isTfvc: true, tfvcPath: item.path,
              lastCommitDate: null, lastCommitAuthor: null, hasLfsMarker: false,
            }))
          } catch {
            if (!cancelled) setTfvcWarning('Could not load TFVC folders — only Git repos are shown.')
          }
        }
        if (cancelled) return
        onSetRepos([...tfvcMapped, ...gitMapped])
        setFetched(true)
      } catch {
        if (!cancelled) setError('Could not reach server. Check your connection.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.org, source.project, source.pat, source.credentialMode, fetched])

  // ── 2. Enrichment (activity + lfs) — runs once after base fetch ────
  useEffect(() => {
    if (!fetched || repos.length === 0) return
    const gitRepos = repos.filter((r) => !r.isTfvc && r.id)
    if (gitRepos.length === 0) return
    const needsEnrichment = gitRepos.some((r) => !enrichedIdsRef.current.has(r.id))
    if (!needsEnrichment) return

    let cancelled = false
    const payload = {
      org: source.org, project: source.project,
      pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
      repos: gitRepos.map((r) => ({ id: r.id, defaultBranch: r.defaultBranch })),
    }
    setEnriching(true)
    Promise.allSettled([
      fetch('/api/azure/repos/activity', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
      fetch('/api/azure/repos/lfs-check', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    ]).then(([activityRes, lfsRes]) => {
      if (cancelled) return
      const activity = activityRes.status === 'fulfilled' ? (activityRes.value.activity || {}) : {}
      const lfs      = lfsRes.status === 'fulfilled'      ? (lfsRes.value.lfs      || {}) : {}
      // Mark repos as enriched BEFORE calling onSetRepos so the guard in the
      // next render cycle short-circuits correctly.
      for (const r of gitRepos) enrichedIdsRef.current.add(r.id)
      onSetRepos(
        repos.map((r) => ({
          ...r,
          lastCommitDate: activity[r.id]?.lastCommitDate ?? r.lastCommitDate,
          lastCommitAuthor: activity[r.id]?.lastCommitAuthor ?? r.lastCommitAuthor,
          hasLfsMarker: lfs[r.id] ?? r.hasLfsMarker,
        }))
      )
    }).finally(() => { if (!cancelled) setEnriching(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched])

  // ── 3. Conflict preview — batched + re-runs on targetOrg change ─────
  const runConflictCheck = useCallback(async (names, targetOwner) => {
    if (!names.length || !targetOwner) return
    try {
      const res = await fetch('/api/import/check-duplicates', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repos: names, targetOwner }),
      })
      const data = await res.json()
      if (res.ok && data.duplicates) setConflictsState(data.duplicates)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (!fetched || repos.length === 0) return
    const owner = targetOrg || source.org
    const names = repos.map((r) => r.name)
    const handle = setTimeout(() => runConflictCheck(names, owner), 500)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, targetOrg, repos.length])

  const retry = useCallback(() => {
    setFetched(false)
    setError('')
    enrichedIdsRef.current = new Set()
  }, [])

  return { loading, error, tfvcWarning, enriching, conflicts: conflictsState, retry }
}
