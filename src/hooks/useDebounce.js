import { useEffect, useState } from 'react'

/**
 * Debounce a value. Returns a copy that lags behind by `delayMs`, updating
 * only after the input stabilises. Standard pattern for search inputs,
 * availability probes, and any side-effect that should fire on the user's
 * pause rather than on every keystroke.
 *
 * @template T
 * @param {T} value          — the input value to debounce
 * @param {number} delayMs   — ms to wait before propagating; defaults to 300ms
 * @returns {T}              — the lagged value
 *
 * @example
 *   const debouncedQ = useDebounce(input, 300)
 *   useEffect(() => { runSearch(debouncedQ) }, [debouncedQ])
 */
export function useDebounce(value, delayMs = 300) {
    const [debounced, setDebounced] = useState(value)

     
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs)
        return () => clearTimeout(timer)
    }, [value, delayMs])
     

    return debounced
}
