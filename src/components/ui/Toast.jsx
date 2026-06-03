import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { AnimatedCheck } from './AnimatedCheck'
import { Tooltip } from './Tooltip'
import { TRANSITION } from './motion'

const ICONS = {
    success: null, // rendered directly as <AnimatedCheck> below
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

export function Toast({ id, type = 'info', message, content, onDismiss, duration = 5000 }) {
    const timerRef = useRef(null)
    const onDismissRef = useRef(onDismiss)

    useEffect(() => {
        onDismissRef.current = onDismiss
    }, [onDismiss])
    const Icon = ICONS[type] ?? Info

    // Auto-dismiss removes the toast from the provider's array; <AnimatePresence>
    // in the container then plays the exit animation — no manual leave-state needed.
    useEffect(() => {
        if (duration > 0) {
            timerRef.current = setTimeout(() => onDismissRef.current(id), duration)
            return () => clearTimeout(timerRef.current)
        }
    }, [duration, id])

    const handleDismiss = () => {
        clearTimeout(timerRef.current)
        onDismiss(id)
    }

	return (
		<motion.div
			layout
			role={type === 'error' ? 'alert' : 'status'}
			aria-live={type === 'error' ? 'assertive' : 'polite'}
			aria-atomic="true"
			initial={{ opacity: 0, x: 24, scale: 0.98 }}
			animate={{ opacity: 1, x: 0, scale: 1 }}
			exit={{ opacity: 0, x: '110%' }}
			transition={TRANSITION.entrance}
			className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md pointer-events-auto w-full max-w-[calc(100vw-2rem)] sm:max-w-sm ${STYLES[type]}`}
		>
            {type === 'success'
                ? <AnimatedCheck size={20} color="currentColor" />
                : <Icon className={`w-5 h-5 shrink-0 ${ICON_STYLES[type]}`} />
            }
            {content ? (
                <div className="flex-1 text-sm">{content}</div>
            ) : (
                <p className="flex-1 text-sm font-medium">{message}</p>
            )}
            <Tooltip label="Dismiss">
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors ds-focus-ring"
                    aria-label="Dismiss notification"
                >
                    <X className="w-4 h-4" />
                </button>
            </Tooltip>
        </motion.div>
    )
}

export function ToastContainer({ toasts, onDismiss }) {
	return (
		<div className="fixed inset-x-0 bottom-20 z-[var(--ds-z-toast)] flex flex-col items-end px-4 space-y-2 pointer-events-none sm:items-end sm:right-4 sm:left-auto sm:max-w-sm safe-area-bottom safe-area-right">
			<AnimatePresence>
				{toasts.map(toast => (
					<Toast key={toast.id} {...toast} onDismiss={onDismiss} />
				))}
			</AnimatePresence>
		</div>
	)
}
