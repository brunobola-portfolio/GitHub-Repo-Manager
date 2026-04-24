import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/workBoardAI'

export function useWorkBoardAI() {
    const [suggestions, setSuggestions] = useState([])
    const [activity, setActivity] = useState(null)
    const [enabled, setEnabled] = useState(true)   // assume on until API says otherwise
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)

    const reload = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
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
        suggestions, activity, enabled, isLoading, error,
        interpret, apply, dismiss, reload,
    }
}
