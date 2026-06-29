// src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js
import { useEffect, useMemo, useState } from 'react'
import { buildDeterministicPlan } from './autoFixRules.js'
import { SIZE_CRITICAL_BYTES } from './riskRules.js'
import { getCsrfToken } from '../../../../utils/api'
import { isAIUnavailable, markAIUnavailable } from '../../../../utils/aiAvailability'
import { isAbort } from '../../../../utils/errorClassification'

// Fix 2: priority-aware error setter (auth > ai-quota)
const ERROR_RANK = { auth: 2, 'ai-quota': 1 }

function worseError(prev, next) {
  if (!prev) return next
  return (ERROR_RANK[next.type] ?? 0) > (ERROR_RANK[prev.type] ?? 0) ? next : prev
}

/**
 * Orchestrates the three-phase auto-fix workflow for the migration Repos step.
 *
 * Phase 1 (sync): buildDeterministicPlan → FixItem[] for renamed blockers.
 * Phase 2 (async): POST /api/import/check-duplicates to validate proposed
 *   names against the target org; sets conflictStatuses[repo.id] to
 *   'clear' | 'conflict' | 'unchecked'.
 * Phase 3 (async, optional): when aiAvailable AND any repo > 10 GB, POST
 *   each to /api/ai/migration-size-strategy and store suggestions.
 *
 * Caller expectations:
 * - Pass stable references for `repos` and `allRepos`; new array identities
 *   every render re-fire all network calls.
 * - Treat `conflictStatuses` and `aiSuggestions` as keyed by repo.id, only
 *   valid for items present in the current `plan` (stale entries are
 *   pruned automatically when the plan changes).
 * - Abort on unmount via the single AbortController is internal; callers
 *   do not need to manage cleanup.
 */
export function useAutoFixPlan({ repos, allRepos, targetOrg, azureProject, conflicts, aiAvailable }) {
  const ctx = useMemo(
    () => ({ allRepos, conflicts: conflicts || {}, targetOrg, azureProject }),
    [allRepos, conflicts, targetOrg, azureProject],
  )

  const plan = useMemo(() => buildDeterministicPlan(repos, ctx), [repos, ctx])

  const [conflictStatuses, setConflictStatuses] = useState({})
  const [rawDuplicates, setRawDuplicates] = useState({})
  const [aiSuggestions, setAiSuggestions] = useState({})
  const [isValidating, setIsValidating] = useState(false)
  const [isAILoading, setIsAILoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    if (plan.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag around a network request; setState is guarded by plan.length and the AbortController pattern below.
      setIsValidating(true)
      const names = plan.map((p) => p.to)
      // Mint the CSRF token BEFORE the POST. The global requireCsrfToken guard
      // (mounted ahead of this route) 403s any mutation missing the header, so
      // this call — which previously sent none — silently failed ('unchecked')
      // on every fire. Mirror the Phase-3 AI call below, which already attaches it.
      getCsrfToken()
        .catch(() => null)
        .then((csrf) =>
          fetch('/api/import/check-duplicates', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            },
            body: JSON.stringify({ targetOrg, repos: names }),
            signal: controller.signal,
          })
        )
        .then(async (res) => {
          // Fix 2: priority-aware auth error
          if (res.status === 401) {
            setError((prev) => worseError(prev, { type: 'auth', message: 'Azure DevOps token expired — please reconnect.' }))
            return
          }
          if (!res.ok) {
            const unchecked = {}
            plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
            // Fix 3: prune stale entries from conflictStatuses
            const currentIds = new Set(plan.map((p) => repos[p.repoIndex].id))
            setConflictStatuses((prev) => {
              const retained = Object.fromEntries(
                Object.entries(prev).filter(([id]) => currentIds.has(id))
              )
              return { ...retained, ...unchecked }
            })
            return
          }
          const data = await res.json()
          const next = {}
          plan.forEach((p) => {
            const repoId = repos[p.repoIndex].id
            next[repoId] = data.duplicates?.[p.to] ? 'conflict' : 'clear'
          })
          // Store raw duplicates so callers can check edited names against known conflicts.
          setRawDuplicates(data.duplicates || {})
          // Fix 3: prune stale entries from conflictStatuses
          const currentIds = new Set(plan.map((p) => repos[p.repoIndex].id))
          setConflictStatuses((prev) => {
            const retained = Object.fromEntries(
              Object.entries(prev).filter(([id]) => currentIds.has(id))
            )
            return { ...retained, ...next }
          })
        })
        .catch((e) => {
          if (isAbort(e)) return
          const unchecked = {}
          plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
          // Fix 3: prune stale entries from conflictStatuses
          const currentIds = new Set(plan.map((p) => repos[p.repoIndex].id))
          setConflictStatuses((prev) => {
            const retained = Object.fromEntries(
              Object.entries(prev).filter(([id]) => currentIds.has(id))
            )
            return { ...retained, ...unchecked }
          })
        })
        .finally(() => setIsValidating(false))
    }

    const sizeCritical = repos.filter((r) => r.selected && r.size > SIZE_CRITICAL_BYTES)
    // Honor the session-scoped AI unavailability cache: if a previous call
    // already returned a fatal 4xx (wrong model / invalid key / no provider),
    // skip the network fan-out entirely.
    if (aiAvailable && !isAIUnavailable() && sizeCritical.length > 0) {
      setIsAILoading(true)
      Promise.allSettled(
        sizeCritical.map(async (repo) => {
          const csrf = await getCsrfToken()
          const res = await fetch('/api/ai/migration-size-strategy', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
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
          if (res.status === 404 || res.status === 422 || res.status === 400) {
            markAIUnavailable(`${res.status}:migration-size-strategy`)
            throw new Error('unavailable')
          }
          if (!res.ok) throw new Error('server')
          const body = await res.json()
          return { repoId: repo.id, body }
        }),
      )
        .then((results) => {
          // Fix 1: guard post-abort state mutation in Phase 3
          if (controller.signal.aborted) return
          const next = {}
          let quotaHit = false
          for (const r of results) {
            if (r.status === 'fulfilled') {
              next[r.value.repoId] = r.value.body
            } else if (r.reason?.message === 'quota') {
              quotaHit = true
            }
          }
          // Fix 3: prune stale entries from aiSuggestions
          const currentSizeIds = new Set(sizeCritical.map((r) => r.id))
          setAiSuggestions((prev) => {
            const retained = Object.fromEntries(
              Object.entries(prev).filter(([id]) => currentSizeIds.has(id))
            )
            return { ...retained, ...next }
          })
          // Fix 2: priority-aware ai-quota error
          if (quotaHit) setError((prev) => worseError(prev, { type: 'ai-quota', message: 'AI quota reached — try again later or upgrade.' }))
        })
        // Fix 1: guard Phase 3 finally block
        .finally(() => {
          if (!controller.signal.aborted) setIsAILoading(false)
        })
    }

    return () => controller.abort()
  }, [plan, repos, targetOrg, aiAvailable])

  return { plan, conflictStatuses, rawDuplicates, aiSuggestions, isValidating, isAILoading, error }
}
