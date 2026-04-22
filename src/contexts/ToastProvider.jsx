import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ToastContext } from './contexts'
import { trackBreadcrumb } from '../lib/observability'

const MAX_TOASTS = 5

/**
 * ToastProvider — owns the single shared toasts array.
 * Wrap the entire app so every component can fire toasts that reach
 * the one <ToastContainer> rendered in App.jsx.
 */
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())
    const idCounter = useRef(0)

    // Clean up all timers on unmount
    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(timer => clearTimeout(timer))
            timers.clear()
        }
    }, [])

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToastRecord = useCallback((record) => {
        const id = ++idCounter.current
        setToasts(prev => {
            const next = [...prev, { id, ...record }]
            if (next.length > MAX_TOASTS) {
                const removed = next.splice(0, next.length - MAX_TOASTS)
                removed.forEach(t => {
                    const timer = timersRef.current.get(t.id)
                    if (timer) {
                        clearTimeout(timer)
                        timersRef.current.delete(t.id)
                    }
                })
            }
            return next
        })
        if (record.duration > 0) {
            const timer = setTimeout(() => dismissToast(id), record.duration)
            timersRef.current.set(id, timer)
        }
        return id
    }, [dismissToast])

    // Backwards-compatible string-message adder.
    const addToast = useCallback((type, message, duration = 5000) => {
        return addToastRecord({ type, message, duration })
    }, [addToastRecord])

    const toast = useMemo(() => ({
        success: (msg, dur) => {
            // Every successful mutation fires a success toast — use that
            // as the boundary to drop a Sentry breadcrumb. When Sentry
            // isn't initialised this is a silent no-op.
            if (typeof msg === 'string' && msg.length > 0) {
                trackBreadcrumb('mutation', msg)
            }
            return addToast('success', msg, dur)
        },
        error:   (msg, dur) => addToast('error', msg, dur),
        info:    (msg, dur) => addToast('info', msg, dur),
        warning: (msg, dur) => addToast('warning', msg, dur),
        // Custom content adder — stores a ReactNode instead of a string message.
        custom:  ({ type = 'info', content, duration = 5000 }) =>
            addToastRecord({ type, content, duration }),
    }), [addToast, addToastRecord])

    const value = useMemo(
        () => ({ toasts, toast, dismissToast }),
        [toasts, toast, dismissToast]
    )

    return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

