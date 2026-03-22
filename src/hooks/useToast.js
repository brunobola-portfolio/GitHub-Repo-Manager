import { useState, useEffect, useCallback, useRef } from 'react'

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

	const addToast = useCallback((type, message, duration = 5000) => {
		const id = Date.now() + Math.random()
		setToasts(prev => [...prev, { id, type, message, duration }])

		// Auto-dismiss after duration
		if (duration > 0) {
			const timer = setTimeout(() => {
				dismissToast(id)
			}, duration)
			timersRef.current.set(id, timer)
		}

		return id
	}, [dismissToast])

	const toast = {
		success: (msg, dur) => addToast('success', msg, dur),
		error: (msg, dur) => addToast('error', msg, dur),
		info: (msg, dur) => addToast('info', msg, dur),
		warning: (msg, dur) => addToast('warning', msg, dur)
	}

	return { toasts, toast, dismissToast }
}
