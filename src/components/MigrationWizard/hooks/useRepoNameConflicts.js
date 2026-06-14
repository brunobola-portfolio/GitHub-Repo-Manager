import { useState, useEffect, useRef, useCallback } from 'react'
import { getCsrfToken } from '../../../utils/api'

/**
 * Owns per-row target-name conflict detection for RepoConfigStep. Status per
 * repo name is 'idle' | 'checking' | 'conflict' | 'clear':
 *  - Azure same-project mode → validated locally against the project's existing
 *    Git repo names (no API call per keystroke);
 *  - otherwise → a 500ms-debounced POST /api/import/check-duplicates.
 *
 * Seeds from cached `repo.risk` flags on mount and re-seeds when the Azure repo
 * list arrives. Extracted from RepoConfigStep (a 1000+ line step); behaviour and
 * the deliberate deps are unchanged. `setConflicts` is exposed so the component
 * can poke a single row's status from its input handlers (mark clear/idle/reset)
 * while the debounced/async detection logic stays encapsulated here.
 *
 * @param {{ source: object, isAzureDevops: boolean, azureProjectRepoNames: Set<string>|null, repos: Array }} args
 * @returns {{ conflicts: object, setConflicts: Function, checkConflict: (repoName: string, targetName: string) => void }}
 */
export function useRepoNameConflicts({ source, isAzureDevops, azureProjectRepoNames, repos }) {
  const [conflicts, setConflicts] = useState({})
  const debounceTimers = useRef({})

  const checkConflict = useCallback(
    (repoName, targetName) => {
      if (debounceTimers.current[repoName]) {
        clearTimeout(debounceTimers.current[repoName])
      }

      if (!targetName?.trim()) {
        setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
        return
      }

      // Azure same-project: validate locally against the project's existing
      // Git repo list. No API call per keystroke.
      if (isAzureDevops) {
        if (!azureProjectRepoNames) {
          setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
          return
        }
        const conflict = azureProjectRepoNames.has(targetName.trim().toLowerCase())
        setConflicts((prev) => ({ ...prev, [repoName]: conflict ? 'conflict' : 'clear' }))
        return
      }

      setConflicts((prev) => ({ ...prev, [repoName]: 'checking' }))

      debounceTimers.current[repoName] = setTimeout(async () => {
        try {
          const csrfToken = await getCsrfToken().catch(() => null)
          const res = await fetch('/api/import/check-duplicates', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            },
            body: JSON.stringify({
              repos: [targetName],
              targetOwner: source.targetOrg || undefined,
            }),
          })
          const data = await res.json()
          if (res.ok && data.duplicates) {
            setConflicts((prev) => ({
              ...prev,
              [repoName]: data.duplicates[targetName] ? 'conflict' : 'clear',
            }))
          } else {
            setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
          }
        } catch {
          setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
        }
      }, 500)
    },
    [source.targetOrg, isAzureDevops, azureProjectRepoNames]
  )

  // When the Azure project repo list arrives (or changes), re-seed conflict
  // status for every row in same-project mode.
  useEffect(() => {
    if (!isAzureDevops || !azureProjectRepoNames) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflicts((prev) => {
      const next = { ...prev }
      repos.forEach((repo) => {
        // A user-confirmed destructive Replace must survive re-seeds.
        if (repo.conflictAction === 'replace') { next[repo.name] = 'will-replace'; return }
        const tn = repo.targetName?.trim()
        if (!tn) { next[repo.name] = 'idle'; return }
        next[repo.name] = azureProjectRepoNames.has(tn.toLowerCase()) ? 'conflict' : 'clear'
      })
      return next
    })
  }, [azureProjectRepoNames, isAzureDevops, repos])

  useEffect(() => {
    const timers = debounceTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Seed conflict state from cached repo.risk flags (set by the Select step).
  // Only a live check runs when the user edits a targetName (checkConflict).
  useEffect(() => {
    const seeded = {}
    repos.forEach((repo) => {
      if (repo.conflictAction === 'replace') { seeded[repo.name] = 'will-replace'; return }
      if (repo.risk?.flags?.some((f) => f.type === 'name-conflict')) seeded[repo.name] = 'conflict'
      else if (repo.targetName?.trim()) seeded[repo.name] = 'clear'
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflicts(seeded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { conflicts, setConflicts, checkConflict }
}
