import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api/workBoardTracking'
import { TrackedReposContext } from './contexts'

function applyPatchToRepo(repos, repoFullName, patch) {
    return repos.map(r =>
        r.repo_full_name === repoFullName ? { ...r, ...patch } : r
    )
}

export function TrackedReposProvider({ children }) {
    const [repos, setRepos] = useState([])
    const [prefs, setPrefs] = useState(null)
    const [countsBySignal, setCountsBySignal] = useState({})
    const [isLoading, setIsLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const pingSentRef = useRef(false)

    const reload = useCallback(async (filters = {}) => {
        const data = await api.fetchTrackedRepos(filters)
        setRepos(data.items)
        setCountsBySignal(data.countsBySignal ?? {})
        return data
    }, [])

    const loadPrefs = useCallback(async () => {
        const p = await api.fetchPrefs()
        setPrefs(p)
        return p
    }, [])

    useEffect(() => {
        if (pingSentRef.current) return
        pingSentRef.current = true
        ;(async () => {
            try {
                setIsLoading(true)
                await api.postPing()
                await Promise.all([reload(), loadPrefs()])
            } catch (e) {
                setError(e)
            } finally {
                setIsLoading(false)
            }
        })()
    }, [reload, loadPrefs])

    const mutateRepo = useCallback(async (repoFullName, action, optimisticPatch) => {
        const previous = repos
        if (optimisticPatch) {
            setRepos(prev => applyPatchToRepo(prev, repoFullName, optimisticPatch))
        }
        try {
            const result = await api.mutateTrackedRepo(repoFullName, action)
            if (result.new_state === null) {
                setRepos(prev => prev.filter(r => r.repo_full_name !== repoFullName))
            } else if (result.new_state) {
                setRepos(prev => applyPatchToRepo(prev, repoFullName, result.new_state))
            }
            return result
        } catch (e) {
            setRepos(previous)
            throw e
        }
    }, [repos])

    const pin = useCallback((repoFullName) => mutateRepo(repoFullName, 'pin', { is_pinned: 1 }), [mutateRepo])
    const unpin = useCallback((repoFullName) => mutateRepo(repoFullName, 'unpin', { is_pinned: 0 }), [mutateRepo])
    const mute = useCallback((repoFullName) => mutateRepo(repoFullName, 'mute', { is_muted: 1 }), [mutateRepo])
    const unmute = useCallback((repoFullName) => mutateRepo(repoFullName, 'unmute', { is_muted: 0 }), [mutateRepo])
    const untrack = useCallback((repoFullName) => mutateRepo(repoFullName, 'untrack', null), [mutateRepo])
    const track = useCallback((repoFullName) => mutateRepo(repoFullName, 'track', null), [mutateRepo])

    const bulkUpdate = useCallback(async (repoFullNames, action) => {
        const result = await api.bulkMutateTrackedRepos(repoFullNames, action)
        await reload()
        return result
    }, [reload])

    const updatePrefs = useCallback(async (patch) => {
        const merged = await api.patchPrefs(patch)
        setPrefs(merged)
        return merged
    }, [])

    const discover = useCallback(async () => {
        setIsRefreshing(true)
        try {
            const result = await api.postDiscover()
            await reload()
            await loadPrefs()
            return result
        } finally {
            setIsRefreshing(false)
        }
    }, [reload, loadPrefs])

    const refresh = useCallback(async (filters = {}) => {
        await reload(filters)
    }, [reload])

    const undo = useCallback(async (operationId) => {
        const result = await api.postUndo(operationId)
        await reload()
        return result
    }, [reload])

    const value = {
        repos,
        prefs,
        countsBySignal,
        isLoading,
        isRefreshing,
        error,
        pin, unpin, mute, unmute, track, untrack,
        bulkUpdate,
        updatePrefs,
        discover,
        refresh,
        undo,
    }

    return <TrackedReposContext.Provider value={value}>{children}</TrackedReposContext.Provider>
}
