/*
 * GitHub Repo Manager
 * Countdown hook — drives UI elements that wait for a future "retry-at" moment.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Countdown hook.
 *
 * @param {number} retryAt      Unix timestamp in ms (same basis as Date.now()).
 * @returns {{ secondsLeft: number, progress01: number, isReady: boolean }}
 *   - secondsLeft: whole seconds remaining, clamped to 0.
 *   - progress01:  1.0 at start of countdown, 0.0 when ready.
 *   - isReady:     true once Date.now() >= retryAt.
 */
export function useCountdown(retryAt) {
    // Pin the starting reference so progress01 is stable across re-renders.
    // eslint-disable-next-line react-hooks/purity -- intentional Date.now() during render to lazy-init startedAtRef on first call only; subsequent renders skip this entirely
    const startedAtRef = useRef(Date.now())
    // eslint-disable-next-line react-hooks/refs -- intentional read-during-render: startedAtRef pins the mount-time clock so totalMs is stable across re-renders
    const totalMs = Math.max(1, retryAt - startedAtRef.current)

    const compute = () => {
        const msLeft = Math.max(0, retryAt - Date.now())
        return {
            secondsLeft: Math.ceil(msLeft / 1000),
            progress01: Math.max(0, Math.min(1, msLeft / totalMs)),
            isReady: msLeft <= 0,
        }
    }

    const [state, setState] = useState(compute)

    useEffect(() => {
        if (Date.now() >= retryAt) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot terminal state when retryAt is already in the past on mount
            setState({ secondsLeft: 0, progress01: 0, isReady: true })
            return
        }

        let intervalId = null

        const tick = () => {
            setState(compute())
            if (Date.now() >= retryAt && intervalId !== null) {
                clearInterval(intervalId)
                intervalId = null
            }
        }

        const startInterval = () => {
            if (intervalId !== null) return
            intervalId = setInterval(tick, 1000)
        }

        const stopInterval = () => {
            if (intervalId === null) return
            clearInterval(intervalId)
            intervalId = null
        }

        const handleVisibilityChange = () => {
            // Recompute immediately so the user sees the correct value on return.
            tick()
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                stopInterval()
            } else {
                startInterval()
            }
        }

        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
            startInterval()
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange)
        }

        return () => {
            stopInterval()
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryAt])

    return useMemo(() => state, [state])
}
