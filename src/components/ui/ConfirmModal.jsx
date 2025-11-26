import { AlertTriangle, Trash2, X } from 'lucide-react'
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
    icon: Icon = AlertTriangle,
    isLoading = false
}) {
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl dark:shadow-slate-900/50 max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`${styles.bg} ${styles.border} border-b p-4 flex items-center gap-3`}>
                    <div className={`p-2 rounded-full ${styles.bg}`}>
                        <Icon className={`w-6 h-6 ${styles.iconColor}`} />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex-1">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

                    {requiresInput && (
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Type <span className="font-bold text-red-600 dark:text-red-400">{requiresInput}</span> to confirm:
                            </label>
                            <input
                                id="confirm-input"
                                type="text"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                placeholder={requiresInput}
                                autoComplete="off"
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
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

