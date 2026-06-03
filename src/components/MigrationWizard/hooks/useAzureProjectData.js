import { useState, useEffect } from 'react'
import { getCsrfToken } from '../../../utils/api'
import { azureCredPayload } from '../../../utils/azureRequestPayload'

/**
 * Loads target-side Azure DevOps data for RepoConfigStep:
 *  - `azureProjectRepoNames`: a Set of existing Git repo names in the target
 *    project (for local, debounce-free name-conflict detection),
 *  - `azureEmptyRepos`: the empty repos in that project (for the "use existing
 *    empty repo" picker),
 *  - `azureProjects`: projects on the org (for the target-project picker),
 *  - `projectsLoading`: in-flight flag for the projects fetch.
 *
 * Extracted verbatim from RepoConfigStep (a 1000+ line step) so the two loaders
 * are isolated and testable; behaviour and the deliberate single-field deps are
 * unchanged.
 *
 * @param {{ isAzureDevops: boolean, source: object, targetProject: string }} args
 */
export function useAzureProjectData({ isAzureDevops, source, targetProject }) {
  const [azureProjectRepoNames, setAzureProjectRepoNames] = useState(null)
  const [azureEmptyRepos, setAzureEmptyRepos] = useState([])
  const [azureProjects, setAzureProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)

  // Existing Git repos in the *target* Azure project — names (conflict detection)
  // + empty repos (the "use existing empty repo" dropdown).
  useEffect(() => {
    if (!isAzureDevops || !source?.org || !targetProject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAzureProjectRepoNames(null)
      setAzureEmptyRepos([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/repos', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            org: source.org,
            project: targetProject,
            ...azureCredPayload(source),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled || !res.ok || !Array.isArray(data.repos)) return
        const names = new Set(
          data.repos
            .filter((r) => !r.isTfvc && r.name)
            .map((r) => r.name.toLowerCase())
        )
        const empty = data.repos
          .filter((r) => !r.isTfvc && r.isEmpty)
          .map((r) => ({ id: r.id, name: r.name, webUrl: r.webUrl }))
        setAzureProjectRepoNames(names)
        setAzureEmptyRepos(empty)
      } catch { /* ignore — leaves cache null, conflict status stays idle */ }
    }
    load()
    return () => { cancelled = true }
    // Depend on individual source fields rather than `source` so unrelated
    // property changes (targetOrg, validated, …) don't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAzureDevops, source?.org, targetProject, source?.host, source?.credentialMode, source?.savedCredentialId, source?.pat])

  // Projects on the org (for the target-project picker).
  useEffect(() => {
    if (!isAzureDevops || !source?.org) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAzureProjects([])
      return
    }
    let cancelled = false
    setProjectsLoading(true)
    const load = async () => {
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/projects', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            org: source.org,
            ...azureCredPayload(source),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled || !res.ok || !Array.isArray(data.projects)) return
        setAzureProjects(data.projects.map((p) => ({ id: p.id, name: p.name })))
      } catch { /* ignore — picker falls back to source.project only */ }
      finally { if (!cancelled) setProjectsLoading(false) }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAzureDevops, source?.org, source?.host, source?.credentialMode, source?.savedCredentialId, source?.pat])

  return { azureProjectRepoNames, azureEmptyRepos, azureProjects, projectsLoading }
}
