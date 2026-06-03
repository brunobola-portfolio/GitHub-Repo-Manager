import { useState, useCallback } from 'react'
import { getCsrfToken } from '../../../utils/api'
import { azureCredPayload } from '../../../utils/azureRequestPayload'

/**
 * Owns the lazy per-repo branch list for RepoConfigStep — which repos are
 * expanded, the cached branch arrays, and the in-flight load flags.
 * `toggleBranchExpand` flips a repo's expansion and fetches its branches from
 * Azure on first open (cached thereafter).
 *
 * Extracted from RepoConfigStep (a 1000+ line step) so the branch logic is
 * isolated and unit-testable; behaviour is unchanged.
 *
 * @param {{ org: string, project: string }} source
 * @returns {{ expandedBranches: object, branchCache: object, loadingBranches: object, toggleBranchExpand: (repo: object, index?: number) => Promise<void> }}
 */
export function useBranchCache(source) {
  const [expandedBranches, setExpandedBranches] = useState({})
  const [branchCache, setBranchCache] = useState({})
  const [loadingBranches, setLoadingBranches] = useState({})

  const toggleBranchExpand = useCallback(async (repo, _index) => {
    const key = repo.id || repo.name
    const isExpanded = expandedBranches[key]

    setExpandedBranches((prev) => ({ ...prev, [key]: !isExpanded }))

    if (!isExpanded && !branchCache[key]) {
      setLoadingBranches((prev) => ({ ...prev, [key]: true }))
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/branches', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            repoId: repo.id,
            ...azureCredPayload(source),
          }),
        })
        const data = await res.json()
        if (res.ok && data.branches) {
          setBranchCache((prev) => ({ ...prev, [key]: data.branches }))
        }
      } catch { /* ignore */ }
      setLoadingBranches((prev) => ({ ...prev, [key]: false }))
    }
  }, [expandedBranches, branchCache, source])

  return { expandedBranches, branchCache, loadingBranches, toggleBranchExpand }
}
