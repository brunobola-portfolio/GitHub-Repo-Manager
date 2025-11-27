import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const ICONS = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
    warning: AlertTriangle
}

const STYLES = {
	success:
		'bg-emerald-50/90 dark:bg-emerald-900/60 border-emerald-300 dark:border-emerald-500 text-emerald-900 dark:text-emerald-100 border-l-4 border-l-emerald-500',
	error:
		'bg-red-50/90 dark:bg-red-900/60 border-red-300 dark:border-red-500 text-red-900 dark:text-red-100 border-l-4 border-l-red-500',
	info:
		'bg-blue-50/90 dark:bg-blue-900/60 border-blue-300 dark:border-blue-500 text-blue-900 dark:text-blue-100 border-l-4 border-l-blue-500',
	warning:
		'bg-amber-50/90 dark:bg-amber-900/60 border-amber-300 dark:border-amber-500 text-amber-900 dark:text-amber-100 border-l-4 border-l-amber-500'
}

const ICON_STYLES = {
    success: 'text-emerald-500 dark:text-emerald-400',
    error: 'text-red-500 dark:text-red-400',
    info: 'text-blue-500 dark:text-blue-400',
    warning: 'text-amber-500 dark:text-amber-400'
}

export function Toast({ id, type = 'info', message, onDismiss, duration = 5000 }) {
    const [isLeaving, setIsLeaving] = useState(false)
    const Icon = ICONS[type] || Info

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                setIsLeaving(true)
                setTimeout(() => onDismiss(id), 300)
            }, duration)
            return () => clearTimeout(timer)
        }
    }, [duration, id, onDismiss])

    const handleDismiss = () => {
        setIsLeaving(true)
        setTimeout(() => onDismiss(id), 300)
    }

	return (
		<div
			className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl dark:shadow-black/70 transition-all duration-300 backdrop-blur-md pointer-events-auto ${
				STYLES[type]
			} ${isLeaving ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}
		>
            <Icon className={`w-5 h-5 shrink-0 ${ICON_STYLES[type]}`} />
            <p className="flex-1 text-sm font-medium">{message}</p>
            <button
                onClick={handleDismiss}
                className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    )
}

export function ToastContainer({ toasts, onDismiss }) {
	return (
		<div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-end px-4 space-y-2 pointer-events-none sm:items-end sm:right-4 sm:left-auto sm:max-w-sm">
			{toasts.map(toast => (
				<Toast key={toast.id} {...toast} onDismiss={onDismiss} />
			))}
		</div>
	)
}

