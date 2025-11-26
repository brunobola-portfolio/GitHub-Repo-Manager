import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const ICONS = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
    warning: AlertTriangle
}

const STYLES = {
    success: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
    info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
    warning: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
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
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg dark:shadow-slate-900/50 transition-all duration-300 backdrop-blur-sm ${
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
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
            {toasts.map(toast => (
                <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
            ))}
        </div>
    )
}

