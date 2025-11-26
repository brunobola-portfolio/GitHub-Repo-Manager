import { useState } from 'react'

// Hook to manage toasts
export function useToast() {
	const [toasts, setToasts] = useState([])

	const addToast = (type, message, duration = 5000) => {
		const id = Date.now() + Math.random()
		setToasts(prev => [...prev, { id, type, message, duration }])
		return id
	}

	const dismissToast = (id) => {
		setToasts(prev => prev.filter(t => t.id !== id))
	}

	const toast = {
		success: (msg, dur) => addToast('success', msg, dur),
		error: (msg, dur) => addToast('error', msg, dur),
		info: (msg, dur) => addToast('info', msg, dur),
		warning: (msg, dur) => addToast('warning', msg, dur)
	}

	return { toasts, toast, dismissToast }
}
