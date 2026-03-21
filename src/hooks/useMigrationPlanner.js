import { useState, useCallback } from 'react'
import { migrationApi } from '../api/migration'

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
