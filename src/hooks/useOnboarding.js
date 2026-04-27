import { useEffect, useState, useCallback } from 'react'

const COMPLETED_KEY = 'grm.onboarding.completedAt'
const LAST_SEEN_KEY = 'grm.onboarding.lastSeenAt'
const RESHOW_THROTTLE_MS = 6 * 60 * 60 * 1000

function safeGet(key) {
    try { return window.localStorage.getItem(key) } catch { return null }
}

function safeSet(key, value) {
    try { window.localStorage.setItem(key, value) } catch { /* fail silent */ }
}

function safeRemove(key) {
    try { window.localStorage.removeItem(key) } catch { /* fail silent */ }
}

function computeShouldShow() {
    const completed = safeGet(COMPLETED_KEY)
    if (completed) return false
    const lastSeen = safeGet(LAST_SEEN_KEY)
    if (lastSeen) {
        const ts = new Date(lastSeen).getTime()
        if (!Number.isNaN(ts) && Date.now() - ts < RESHOW_THROTTLE_MS) return false
    }
    return true
}

/**
 * useOnboarding — flag + helpers for the first-run tour.
 *
 * The hook reads localStorage once on mount; consumers re-render only when
 * markComplete / markSeen / reset are called. Storage failures (private
 * mode, etc.) degrade gracefully to "always show this session" without
 * throwing.
 */
export function useOnboarding() {
    const [shouldShow, setShouldShow] = useState(false)

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShouldShow(computeShouldShow())
    }, [])

    const markComplete = useCallback(() => {
        safeSet(COMPLETED_KEY, new Date().toISOString())
        setShouldShow(false)
    }, [])

    const markSeen = useCallback(() => {
        safeSet(LAST_SEEN_KEY, new Date().toISOString())
        setShouldShow(false)
    }, [])

    const reset = useCallback(() => {
        safeRemove(COMPLETED_KEY)
        safeRemove(LAST_SEEN_KEY)
        setShouldShow(true)
    }, [])

    return { shouldShow, markComplete, markSeen, reset }
}
