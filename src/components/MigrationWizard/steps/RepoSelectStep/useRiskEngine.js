import { useMemo } from 'react'
import { evaluateRepo, aggregateRisk } from './riskRules'

/**
 * Compute risk for every repo. Pure memoization over repos, conflicts, targetOrg.
 * Returns a new array with `risk` attached to each repo.
 */
export function useRiskEngine(repos, conflicts, targetOrg) {
  return useMemo(() => {
    const ctx = { allRepos: repos, conflicts: conflicts || {}, targetOrg }
    const scored = repos.map((repo) => ({ ...repo, risk: evaluateRepo(repo, ctx) }))
    const aggregate = aggregateRisk(scored)
    const aggregateSelected = aggregateRisk(scored.filter((r) => r.selected))
    return { repos: scored, aggregate, aggregateSelected }
  }, [repos, conflicts, targetOrg])
}
