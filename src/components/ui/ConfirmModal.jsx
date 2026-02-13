import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'

export function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirm Action',
    message = 'Are you sure?',
	    confirmText = 'Confirm',
	    cancelText = 'Cancel',
	    variant = 'danger', // danger, warning, info
	    requiresInput = null, // e.g., 'DELETE' to type
	    icon = AlertTriangle,
	    isLoading = false
	}) {
	    const IconComponent = icon
	    const modalRef = useRef(null)
	    if (!isOpen) return null

    const handleConfirm = () => {
        if (requiresInput) {
            const input = document.getElementById('confirm-input')?.value
            if (input !== requiresInput) {
                alert(`Please type "${requiresInput}" to confirm`)
                return
            }
        }
        onConfirm()
    }

    const variantStyles = {
        danger: {
            bg: 'bg-red-50 dark:bg-red-900/30',
            border: 'border-red-200 dark:border-red-800',
            iconColor: 'text-red-500 dark:text-red-400',
            buttonVariant: 'danger'
        },
        warning: {
            bg: 'bg-amber-50 dark:bg-amber-900/30',
            border: 'border-amber-200 dark:border-amber-800',
            iconColor: 'text-amber-500 dark:text-amber-400',
            buttonVariant: 'warning'
        },
        info: {
            bg: 'bg-blue-50 dark:bg-blue-900/30',
            border: 'border-blue-200 dark:border-blue-800',
            iconColor: 'text-blue-500 dark:text-blue-400',
            buttonVariant: 'primary'
        }
    }

    const styles = variantStyles[variant] || variantStyles.danger

    // Scroll input into view when keyboard appears (mobile fix)
    useEffect(() => {
        if (!isOpen) return

        const handleFocus = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300) // Delay for keyboard animation
            }
        }

        const modal = modalRef.current
        modal?.addEventListener('focusin', handleFocus)
        return () => modal?.removeEventListener('focusin', handleFocus)
    }, [isOpen])

	    return (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-modal-title"
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl dark:shadow-black/40 max-w-md w-full max-h-[85vh] md:max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
	                <div className={`${styles.bg} ${styles.border} border-b p-4 flex items-center gap-3 flex-shrink-0`}>
	                    <div className={`p-2 rounded-full ${styles.bg}`}>
	                        {IconComponent && <IconComponent className={`w-6 h-6 ${styles.iconColor}`} />}
                    </div>
                    <h2 id="confirm-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex-1">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="p-6 flex-1 overflow-y-auto">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

                    {requiresInput && (
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Type <span className="font-bold text-red-600 dark:text-red-400">{requiresInput}</span> to confirm:
                            </label>
                            <input
                                id="confirm-input"
                                type="text"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder={requiresInput}
                                autoComplete="off"
                            />
                        </div>
                    )}
                </div>

                {/* Footer - Fixed */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 flex-shrink-0">
                    <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                        {cancelText}
                    </Button>
                    <Button variant={styles.buttonVariant} onClick={handleConfirm} disabled={isLoading}>
                        {isLoading ? 'Processing...' : confirmText}
                    </Button>
                </div>
            </div>
        </div>
    )
}

