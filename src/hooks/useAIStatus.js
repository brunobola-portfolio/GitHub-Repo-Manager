import { useEffect, useState } from 'react'
import { getAIStatus, invalidateAIStatus, subscribeAIStatus, peekAIStatus } from '../api/aiStatus'

export function useAIStatus() {
    const initial = peekAIStatus()
    const [status, setStatus] = useState(initial)
    const [loading, setLoading] = useState(!initial)

    useEffect(() => {
        let cancelled = false
        const unsubscribe = subscribeAIStatus((next) => {
            if (!cancelled) setStatus(next)
        })
        getAIStatus().then((s) => {
            if (!cancelled) {
                setStatus(s)
                setLoading(false)
            }
        })
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [])

    const refresh = () => {
        invalidateAIStatus()
        setLoading(true)
        return getAIStatus({ force: true }).finally(() => setLoading(false))
    }

    const keyHealth = status?.keyHealth ?? 'unknown'

    return {
        configured: !!status?.configured,
        provider: status?.provider ?? null,
        keyHealth,
        // Convenience flag for UI: configured key has been observed to fail auth.
        keyInvalid: !!status?.configured && keyHealth === 'invalid',
        keyOk: !!status?.configured && keyHealth === 'ok',
        lastCheckedAt: status?.lastCheckedAt ?? null,
        loading,
        refresh,
    }
}
