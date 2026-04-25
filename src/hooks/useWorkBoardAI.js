import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/workBoardAI'

export function useWorkBoardAI() {
    const [suggestions, setSuggestions] = useState([])
    const [activity, setActivity] = useState(null)
    const [enabled, setEnabled] = useState(true)   // assume on until API says otherwise
    const [reason, setReason] = useState(null)     // 'AI_FEATURE_FLAG_OFF' | 'AI_ASSISTANT_DISABLED' | 'AI_COST_CAP_REACHED' | 'OK' | null
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)

    const reload = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            // Pre-check so we don't fire two gated requests when the feature
            // flag is off or the user hasn't opted in — keeps the console
            // clean instead of surfacing harmless 403/404s.
            const status = await api.fetchStatus().catch(() => ({ enabled: false, reason: 'UNKNOWN' }))
            setReason(status?.reason ?? null)
            if (!status?.enabled) {
                setEnabled(false)
                setSuggestions([])
                setActivity(null)
                return
            }

            const [s, a] = await Promise.all([api.fetchSuggestions(), api.fetchActivity()])
            setSuggestions(s.suggestions ?? [])
            setActivity(a)
            setEnabled(true)
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                setEnabled(false)
                setSuggestions([])
                setActivity(null)
            } else {
                setError(e)
            }
        } finally {
            setIsLoading(false)
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { reload() }, [reload])

    const dismiss = useCallback(async (pattern_key, repo_full_name = '') => {
        await api.dismissSuggestion(pattern_key, repo_full_name)
        await reload()
    }, [reload])

    const interpret = useCallback((prompt) => {
        return api.interpretPrompt(prompt)
    }, [])

    const apply = useCallback(async (validity_token) => {
        const result = await api.applyDiff(validity_token)
        await reload()
        return result
    }, [reload])

    return {
        suggestions, activity, enabled, reason, isLoading, error,
        interpret, apply, dismiss, reload,
    }
}
