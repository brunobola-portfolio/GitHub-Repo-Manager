import { useState, useCallback, useRef, useEffect } from 'react'

const MAX_CONCURRENT = 5

/**
 * Hook for fetching and caching Azure DevOps organizations (OAuth mode)
 * and lazily enriching them with project counts.
 *
 * organizations: Array<{ accountId, accountName, accountUri }>
 * orgProjectCounts: { [orgName]: number | null }  (null = loading/failed)
 */
export function useAzureOrganizations() {
  const [organizations, setOrganizations] = useState([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [orgsError, setOrgsError] = useState(null)
  const [orgProjectCounts, setOrgProjectCounts] = useState({})
  const cacheRef = useRef({ orgs: null, counts: {} })
  const abortRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  const fetchOrganizations = useCallback(async (retryCount = 0) => {
    // Return cached if available
    if (cacheRef.current.orgs) {
      setOrganizations(cacheRef.current.orgs)
      setOrgProjectCounts(cacheRef.current.counts)
      return cacheRef.current.orgs
    }

    // Abort previous request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // 10-second timeout
    const timeoutId = setTimeout(() => controller.abort(), 10_000)

    setOrgsLoading(true)
    setOrgsError(null)

    try {
      const res = await fetch('/api/azure/organizations', {
        credentials: 'include',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.status === 401) {
        throw new Error('TOKEN_EXPIRED')
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to list organizations (${res.status})`)
      }

      const data = await res.json()
      const orgs = data.organizations || []
      cacheRef.current.orgs = orgs
      setOrganizations(orgs)
      setOrgsError(null)
      return orgs
    } catch (e) {
      clearTimeout(timeoutId)
      if (!mountedRef.current) return []
      if (e.name === 'AbortError') {
        // Auto-retry once on timeout
        if (retryCount < 1 && mountedRef.current) {
          return fetchOrganizations(retryCount + 1)
        }
        setOrgsError('Timeout — could not list organizations')
        setOrganizations([])
        return []
      }
      // Auto-retry once on 401 (token expired)
      if (e.message === 'TOKEN_EXPIRED' && retryCount < 1 && mountedRef.current) {
        return fetchOrganizations(retryCount + 1)
      }
      if (!mountedRef.current) return []
      setOrgsError(e.message)
      setOrganizations([])
      return []
    } finally {
      if (mountedRef.current) setOrgsLoading(false)
    }
  }, [])

  /**
   * Fetch project counts for visible orgs (lazy, on dropdown open).
   * Uses a semaphore to limit concurrency.
   */
  const fetchProjectCounts = useCallback(async (orgNames, pat) => {
    const toFetch = orgNames.filter(
      (name) => cacheRef.current.counts[name] === undefined
    )
    if (toFetch.length === 0) return

    // Set loading state (null = loading)
    setOrgProjectCounts((prev) => {
      const next = { ...prev }
      for (const name of toFetch) next[name] = null
      return next
    })

    // Fetch in batches with max concurrency
    const queue = [...toFetch]
    const run = async () => {
      while (queue.length > 0) {
        const orgName = queue.shift()
        try {
          const res = await fetch('/api/azure/projects', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              org: orgName,
              pat: pat || undefined,
            }),
          })
          const data = await res.json()
          const count = (data.projects || []).length
          cacheRef.current.counts[orgName] = count
          setOrgProjectCounts((prev) => ({ ...prev, [orgName]: count }))
        } catch {
          cacheRef.current.counts[orgName] = -1 // mark as failed
          setOrgProjectCounts((prev) => ({ ...prev, [orgName]: -1 }))
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT, toFetch.length) },
      () => run()
    )
    await Promise.all(workers)
  }, [])

  const clearCache = useCallback(() => {
    cacheRef.current = { orgs: null, counts: {} }
    setOrganizations([])
    setOrgProjectCounts({})
    setOrgsError(null)
  }, [])

  return {
    organizations,
    orgsLoading,
    orgsError,
    orgProjectCounts,
    fetchOrganizations,
    fetchProjectCounts,
    clearCache,
  }
}
