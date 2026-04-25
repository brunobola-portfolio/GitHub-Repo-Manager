import { useEffect, useMemo, useRef } from 'react'

/**
 * Debounce a callback. Returns a stable wrapper that schedules `fn` to run
 * `delayMs` after the most recent invocation; subsequent calls reset the
 * timer. The wrapper carries a `.cancel()` method so callers can abort a
 * pending invocation explicitly (e.g. on submit, on unmount of an item).
 *
 * Use when the trigger is imperative (a per-row event handler that should
 * coalesce) — for value-driven debouncing, prefer useDebounce(value, ms).
 *
 * The latest `fn` reference is captured via ref so callers don't need to
 * memoise; identity changes mid-cycle are honoured at next invocation.
 *
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {number} delayMs
 * @returns {((...args: Parameters<F>) => void) & { cancel(): void }}
 */
export function useDebouncedCallback(fn, delayMs = 300) {
    const fnRef = useRef(fn)
    const timerRef = useRef(null)

     
    useEffect(() => {
        fnRef.current = fn
    }, [fn])
     

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    // Build the wrapper inside useMemo so we can attach `.cancel` at
    // construction time — assigning after a useCallback return trips the
    // react-hooks/immutability lint rule.
    return useMemo(() => {
        function debounced(...args) {
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
                timerRef.current = null
                fnRef.current?.(...args)
            }, delayMs)
        }
        debounced.cancel = () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
        return debounced
    }, [delayMs])
}
