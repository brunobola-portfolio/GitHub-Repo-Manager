import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// Hook to manage toasts with auto-dismiss
export function useToast() {
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

    return { toasts, toast, dismissToast }
}
