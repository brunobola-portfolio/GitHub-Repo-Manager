import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Standardised loader for RepoDetail tabs (Branches, Releases, Issues, PRs,
 * Overview, Actions, PRDetailPanel comments, IssueDetailPanel comments).
 *
 * Each tab previously hand-rolled the same `useState(loading) + try/catch +
 * useCallback + useEffect(reload)` boilerplate (~60 lines × 8 components).
 * This hook collapses that pattern and adds AbortController-based cancellation
 * so a tab switch / repo change cancels in-flight work instead of racing to
 * setState on an unmounted (or now-irrelevant) tab.
 *
 * Usage:
 *   const { data, loading, error, reload } = useTabData(
 *     (signal) => api.fetchBranches({ signal }),
 *     [api],
 *   )
 *
 * The loader receives an AbortSignal as its sole argument. If your underlying
 * fetcher doesn't support signals, you can ignore it — the hook still gates
 * setState behind `!signal.aborted` so stale results never land in state.
 *
 * @param {(signal: AbortSignal) => Promise<unknown>} loader
 * @param {ReadonlyArray<unknown>} deps - re-run when any of these changes
 * @returns {{ data: unknown, loading: boolean, error: Error|null, reload: () => Promise<void> }}
 */
export function useTabData(loader, deps) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const loaderRef = useRef(loader)
    loaderRef.current = loader

    // reload returns a Promise so callers can `await reload()` after a mutation
    // (e.g. createBranch) before re-rendering UI that depends on the new data.
    const reload = useCallback(async () => {
        const controller = new AbortController()
        setLoading(true)
        setError(null)
        try {
            const result = await loaderRef.current(controller.signal)
            if (!controller.signal.aborted) setData(result)
        } catch (e) {
            if (controller.signal.aborted || e?.name === 'AbortError') return
            setError(e)
        } finally {
            if (!controller.signal.aborted) setLoading(false)
        }
        return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)

    useEffect(() => {
        const controller = new AbortController()
        ;(async () => {
            setLoading(true)
            setError(null)
            try {
                const result = await loaderRef.current(controller.signal)
                if (!controller.signal.aborted) setData(result)
            } catch (e) {
                if (controller.signal.aborted || e?.name === 'AbortError') return
                setError(e)
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        })()
        return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)

    return { data, loading, error, reload }
}
