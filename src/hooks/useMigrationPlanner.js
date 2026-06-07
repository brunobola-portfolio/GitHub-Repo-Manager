import { useState, useCallback } from 'react'
import { migrationApi } from '../api/migration'

/**
 * useMigrationPlanner — AI migration-planning interface (planned, not yet wired).
 *
 * Part of the enhanced-migration-system design
 * (docs/specs/2026-03-21-enhanced-migration-system-design.md, Task 21). The
 * hook is implemented but has no UI consumer yet; it's retained intentionally
 * for that upcoming work. Not dead code — don't delete without revisiting the
 * spec.
 */
export function useMigrationPlanner() {
  const [analyzing, setAnalyzing] = useState(false)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)

  const analyzeMigration = useCallback(async (context) => {
    setAnalyzing(true)
    setError(null)
    try {
      const result = await migrationApi.analyze(context)
      setPlan(result)
      return result
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setAnalyzing(false)
    }
  }, [])

  const reset = useCallback(() => { setPlan(null); setError(null) }, [])

  return { analyzeMigration, analyzing, plan, error, reset }
}
