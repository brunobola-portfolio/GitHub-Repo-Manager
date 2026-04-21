import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useMobileKeyboardFix } from '../../hooks/useMobileKeyboardFix'

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
    const modalRef = useFocusTrap(isOpen, onClose)
    useBodyScrollLock(isOpen)
    useMobileKeyboardFix(isOpen, modalRef)
    const [inputValue, setInputValue] = useState('')
    const [inputError, setInputError] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [confirmError, setConfirmError] = useState(null)

    // Reset input when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setInputValue('')
            setInputError('')
            setIsSubmitting(false)
            setConfirmError(null)
        }
    }, [isOpen])

    const handleConfirm = async () => {
        if (isSubmitting) return
        if (requiresInput) {
            if (inputValue !== requiresInput) {
                setInputError(`Please type "${requiresInput}" to confirm`)
                return
            }
        }
        setIsSubmitting(true)
        setConfirmError(null)
        try {
            await onConfirm()
        } catch (err) {
            setConfirmError(err.message || 'Operation failed. Please try again.')
        } finally {
            setIsSubmitting(false)
        }
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
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-md p-4"
                >
                    <motion.div
                        ref={modalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirm-modal-title"
                        aria-describedby="confirm-modal-body"
                        initial={{ opacity: 0, scale: 0.98, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 24 }}
                        transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white dark:bg-slate-950 rounded-2xl shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] ring-1 ring-slate-200/50 dark:ring-slate-700/50 max-w-md w-full max-h-[85vh] md:max-h-[90vh] flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className={`${styles.bg} ${styles.border} border-b px-4 py-3.5 flex items-center gap-3 flex-shrink-0`}>
                            <div className={`p-2 rounded-full ${styles.bg}`}>
                                {IconComponent && <IconComponent className={`w-6 h-6 ${styles.iconColor}`} />}
                            </div>
                            <h2 id="confirm-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex-1">{title}</h2>
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-2 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-colors"
                                aria-label="Close modal"
                            >
                                <X className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                            </button>
                        </div>

                        {/* Body - Scrollable */}
                        <div className="ds-modal-body bg-slate-50/30 dark:bg-slate-950/50 flex-1 overflow-y-auto">
                            <p id="confirm-modal-body" className="text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

                            {requiresInput && (
                                <div className="mt-4">
                                    <label htmlFor="confirm-input" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Type <span className="font-bold text-red-600 dark:text-red-400">{requiresInput}</span> to confirm:
                                    </label>
                                    <input
                                        id="confirm-input"
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => { setInputValue(e.target.value); setInputError(''); }}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        placeholder={requiresInput}
                                        autoComplete="off"
                                        aria-describedby={inputError ? 'confirm-input-error' : undefined}
                                    />
                                    {inputError && (
                                        <p id="confirm-input-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">{inputError}</p>
                                    )}
                                </div>
                            )}
                            {confirmError && (
                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                                    <p className="text-sm text-red-700 dark:text-red-300">{confirmError}</p>
                                </div>
                            )}
                        </div>

                        {/* Footer - Fixed */}
                        <div className="flex items-center justify-end gap-3 min-h-[68px] px-6 bg-white/80 dark:bg-slate-900/70 border-t border-slate-200/50 dark:border-slate-800/40 flex-shrink-0">
                            <Button variant="ghost" onClick={onClose} disabled={isLoading || isSubmitting}>
                                {cancelText}
                            </Button>
                            <Button variant={styles.buttonVariant} onClick={handleConfirm} disabled={isLoading || isSubmitting}>
                                {(isLoading || isSubmitting) ? 'Processing...' : confirmText}
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
