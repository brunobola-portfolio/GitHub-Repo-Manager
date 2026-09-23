import { useEffect, useRef, useState } from 'react'
import { isAbort } from '../../utils/errorClassification'
import { searchApi } from '../../api/search'
import { translateSearch } from '../../api/translateSearch'
import { useDebounce } from '../../hooks/useDebounce'

const DEBOUNCE_MS = 300
const MIN_QUERY_LEN = 2
const ASK_DEBOUNCE_MS = 450
export const ASK_MIN_LEN = 4

const EMPTY_SEARCH = { prs: [], issues: [], repos: [] }

/**
 * Debounce `value`, then run `fetcher(query, signal)` once it is at least
 * `minLen` long, aborting the previous request each time. A fetcher that
 * resolves to null/undefined is a failure reported as `failCode`; one that
 * throws keeps the last data and reports the error's code.
 *
 * The GitHub search and the ask-mode translator were two copies of this, and
 * this is the part that has to be right in both: an answer that arrives after
 * the user typed on must never land.
 */
function useDebouncedRemoteQuery(value, { enabled, ms, minLen, empty, fetcher, failCode }) {
    const [state, setState] = useState({ data: empty, loading: false, error: null })
    const controllerRef = useRef(null)
    const debounced = useDebounce(value, ms)
    const shouldFetch = enabled && debounced.length >= minLen

    /* eslint-disable react-hooks/set-state-in-effect -- the debounced query drives the fetch */
    useEffect(() => {
        controllerRef.current?.abort()
        if (!shouldFetch) {
            setState({ data: empty, loading: false, error: null })
            return undefined
        }
        const controller = new AbortController()
        controllerRef.current = controller
        setState((prev) => ({ ...prev, loading: true, error: null }))
        fetcher(debounced, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return
                setState(data == null
                    ? { data: empty, loading: false, error: failCode }
                    : { data, loading: false, error: null })
            })
            .catch((err) => {
                if (isAbort(err, controller.signal)) return
                setState((prev) => ({ ...prev, loading: false, error: err?.code || failCode }))
            })
        return () => controller.abort()
        // `empty`, `fetcher` and `failCode` are module constants at every call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldFetch, debounced])
    /* eslint-enable react-hooks/set-state-in-effect */

    return state
}

const fetchGitHub = (q, signal) =>
    searchApi.github(q, { type: 'all', limit: 15, signal })
        .then((res) => ({ prs: res.prs || [], issues: res.issues || [], repos: res.repos || [] }))

export function useDebouncedGitHubSearch(query, enabled) {
    return useDebouncedRemoteQuery((query || '').trim(), {
        enabled, ms: DEBOUNCE_MS, minLen: MIN_QUERY_LEN, empty: EMPTY_SEARCH,
        fetcher: fetchGitHub, failCode: 'SEARCH_FAILED',
    })
}

const fetchTranslation = (q, signal) => translateSearch({ q, signal })

export function useDebouncedTranslateSearch(askQuery, enabled) {
    return useDebouncedRemoteQuery(askQuery, {
        enabled, ms: ASK_DEBOUNCE_MS, minLen: ASK_MIN_LEN, empty: null,
        fetcher: fetchTranslation, failCode: 'TRANSLATE_FAILED',
    })
}

/**
 * Detects "ask mode" — query starts with a literal `?`. The leading char
 * is stripped before sending to the translator. Empty after strip → no fire.
 */
export function parseAskMode(rawInput) {
    const trimmed = (rawInput || '').trimStart()
    if (!trimmed.startsWith('?')) return { askMode: false, askQuery: '' }
    return { askMode: true, askQuery: trimmed.slice(1).trim() }
}

/**
 * Once the translator returns queries, fire them in parallel against the
 * existing /search/github endpoint and accumulate results per type. We
 * only run when ask mode is active so non-ask palette use is unaffected.
 */
export function useAskModeResults(translatedQueries, enabled) {
    const [results, setResults] = useState({ pr: [], issue: [], repo: [] })
    const [loading, setLoading] = useState(false)
    /* eslint-disable react-hooks/set-state-in-effect -- input changes drive AI search fan-out */
    useEffect(() => {
        if (!enabled || !translatedQueries || translatedQueries.length === 0) {
            setResults({ pr: [], issue: [], repo: [] })
            setLoading(false)
            return undefined
        }
        const ctrl = new AbortController()
        let cancelled = false
        setLoading(true)
        const promises = translatedQueries.map((q) =>
            searchApi.github(q.ghQuery, { type: q.type, limit: 10, signal: ctrl.signal })
                .then((res) => ({ type: q.type, res }))
                .catch(() => ({ type: q.type, res: null }))
        )
        Promise.all(promises).then((parts) => {
            if (cancelled) return
            const merged = { pr: [], issue: [], repo: [] }
            for (const { type, res } of parts) {
                if (!res) continue
                if (type === 'pr' && Array.isArray(res.prs)) merged.pr.push(...res.prs)
                if (type === 'issue' && Array.isArray(res.issues)) merged.issue.push(...res.issues)
                if (type === 'repo' && Array.isArray(res.repos)) merged.repo.push(...res.repos)
            }
            setResults(merged)
            setLoading(false)
        })
        return () => {
            cancelled = true
            ctrl.abort()
        }
    }, [enabled, translatedQueries])
    /* eslint-enable react-hooks/set-state-in-effect */
    return { results, loading }
}
