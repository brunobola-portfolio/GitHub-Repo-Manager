import { useState, useEffect, useCallback, useRef, useMemo, useContext } from 'react'
import { ToastContext } from './contexts'

/**
 * ToastProvider — owns the single shared toasts array.
 * Wrap the entire app so every component can fire toasts that reach
 * the one <ToastContainer> rendered in App.jsx.
 */
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())

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
        const id = Date.now() + Math.random()
        setToasts(prev => [...prev, { id, ...record }])
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
        success: (msg, dur) => addToast('success', msg, dur),
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

/**
 * useToast — read the shared toast context.
 * Returns the same shape as the old plain hook: { toast, toasts, dismissToast }
 */
export function useToast() {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within a <ToastProvider>')
    }
    return ctx
}
