// src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js
import { useEffect, useMemo, useState } from 'react'
import { buildDeterministicPlan } from './autoFixRules.js'

const SIZE_CRITICAL_KB = 10 * 1024 * 1024 // 10 GB

export function useAutoFixPlan({ repos, allRepos, targetOrg, azureProject, aiAvailable }) {
  const ctx = useMemo(
    () => ({ allRepos, conflicts: {}, targetOrg, azureProject }),
    [allRepos, targetOrg, azureProject],
  )

  const plan = useMemo(() => buildDeterministicPlan(repos, ctx), [repos, ctx])

  const [conflictStatuses, setConflictStatuses] = useState({})
  const [aiSuggestions, setAiSuggestions] = useState({})
  const [isValidating, setIsValidating] = useState(false)
  const [isAILoading, setIsAILoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    if (plan.length > 0) {
      setIsValidating(true)
      const names = plan.map((p) => p.to)
      fetch('/api/import/check-duplicates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOrg, repos: names }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.status === 401) {
            setError({ type: 'auth', message: 'Azure DevOps token expired — please reconnect.' })
            return
          }
          if (!res.ok) {
            const unchecked = {}
            plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
            setConflictStatuses((prev) => ({ ...prev, ...unchecked }))
            return
          }
          const data = await res.json()
          const next = {}
          plan.forEach((p) => {
            const repoId = repos[p.repoIndex].id
            next[repoId] = data.duplicates?.[p.to] ? 'conflict' : 'clear'
          })
          setConflictStatuses((prev) => ({ ...prev, ...next }))
        })
        .catch((e) => {
          if (e.name === 'AbortError') return
          const unchecked = {}
          plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
          setConflictStatuses((prev) => ({ ...prev, ...unchecked }))
        })
        .finally(() => setIsValidating(false))
    }

    const sizeCritical = repos.filter((r) => r.selected && r.size > SIZE_CRITICAL_KB)
    if (aiAvailable && sizeCritical.length > 0) {
      setIsAILoading(true)
      Promise.allSettled(
        sizeCritical.map(async (repo) => {
          const res = await fetch('/api/ai/migration-size-strategy', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoId: repo.id,
              size: repo.size,
              hasLfsMarker: !!repo.hasLfsMarker,
              branches: repo.branches,
              lastCommitDate: repo.lastCommitDate,
            }),
            signal: controller.signal,
          })
          if (res.status === 429) throw new Error('quota')
          if (!res.ok) throw new Error('server')
          const body = await res.json()
          return { repoId: repo.id, body }
        }),
      )
        .then((results) => {
          const next = {}
          let quotaHit = false
          for (const r of results) {
            if (r.status === 'fulfilled') {
              next[r.value.repoId] = r.value.body
            } else if (r.reason?.message === 'quota') {
              quotaHit = true
            }
          }
          setAiSuggestions((prev) => ({ ...prev, ...next }))
          if (quotaHit) setError({ type: 'ai-quota', message: 'AI quota reached — try again later or upgrade.' })
        })
        .finally(() => setIsAILoading(false))
    }

    return () => controller.abort()
  }, [plan, repos, targetOrg, aiAvailable])

  return { plan, conflictStatuses, aiSuggestions, isValidating, isAILoading, error }
}
