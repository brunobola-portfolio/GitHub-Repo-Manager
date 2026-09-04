import { useEffect, useState, useCallback, useRef } from 'react'
import { apiCall } from '../../../../utils/api'
import { API_BASE } from '../../../../config'
import { azurePost } from '../../../../api/azure'

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
  const [conflictDetailsState, setConflictDetailsState] = useState({})
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
        const data = await azurePost('/azure/repos', source, {
          org: source.org,
          project: source.project,
        })
        if (!data.repos) {
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
            const tfvcData = await azurePost('/azure/tfvc/items', source, {
              org: source.org, project: source.project,
            })
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
      } catch (e) {
        if (!cancelled) setError(e.data?.error || 'Could not reach server. Check your connection.')
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
    const extra = {
      org: source.org, project: source.project,
      repos: gitRepos.map((r) => ({ id: r.id, defaultBranch: r.defaultBranch })),
    }
    setEnriching(true)
    ;(async () => {
      const [activityRes, lfsRes] = await Promise.allSettled([
        azurePost('/azure/repos/activity', source, extra),
        azurePost('/azure/repos/lfs-check', source, extra),
      ])
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
    })().finally(() => { if (!cancelled) setEnriching(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched])

  // ── 3. Conflict preview — batched + re-runs on targetOrg/targetName change
  const runConflictCheck = useCallback(async (names, targetOwner) => {
    if (!names.length) return
    try {
      // Route through apiCall so a stale CSRF token self-heals (it refetches +
      // retries once on 403 csrf_invalid). A raw fetch here 403'd with no
      // recovery, dropping the conflict preview silently.
      // targetOwner is sent only when truthy; the server resolves to the
      // authenticated user's GitHub login when omitted (avoids the old bug
      // where the Azure org name was sent as a GitHub owner).
      const data = await apiCall(`${API_BASE}/import/check-duplicates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetOwner ? { repos: names, targetOwner } : { repos: names }),
      })
      if (data?.duplicates) {
        setConflictsState(data.duplicates)
        // Details are optional (older servers won't send them). When absent,
        // downstream consumers fall back to the boolean map and lose the
        // "empty target" hint, which is graceful — no crashes.
        if (data.duplicateDetails) setConflictDetailsState(data.duplicateDetails)
      }
    } catch { /* non-fatal */ }
  }, [])

  // Effective name string — used both as request payload and as the effect
  // signature so a rename via AutoFix retriggers the check (the old version
  // only watched repos.length, so renames silently kept stale verdicts).
  const effectiveNames = repos
    .map((r) => (r.targetName && r.targetName.trim()) || r.name)
    .join('|')

  useEffect(() => {
    if (!fetched || repos.length === 0) return
    const names = effectiveNames.split('|').filter(Boolean)
    const handle = setTimeout(() => runConflictCheck(names, targetOrg), 500)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveNames is the join of every repo's effective name; depending on it captures rename edits without needing the full `repos` array (which has unrelated mutation triggers via enrichment).
  }, [fetched, targetOrg, effectiveNames])

  const retry = useCallback(() => {
    setFetched(false)
    setError('')
    enrichedIdsRef.current = new Set()
  }, [])

  return { loading, error, tfvcWarning, enriching, conflicts: conflictsState, conflictDetails: conflictDetailsState, retry }
}
