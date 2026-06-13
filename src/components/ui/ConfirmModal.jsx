import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, ModalFooter } from './Modal'
import { Button } from './Button'
import { Kbd } from './Kbd'

/**
 * ConfirmModal — danger/warning/info confirmation dialog.
 *
 * Internally delegates to the shared <Modal> primitive so the header
 * (gradient bar + icon tile + close button) matches the rest of the app's
 * modal family. The public API is unchanged.
 */
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
    const [inputValue, setInputValue] = useState('')
    const [inputError, setInputError] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [confirmError, setConfirmError] = useState(null)

    // Reset input when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on open; the alternative (key prop) churns the modal subtree
            setInputValue('')
            setInputError('')
            setIsSubmitting(false)
            setConfirmError(null)
        }
    }, [isOpen])

    const handleConfirm = useCallback(async () => {
        if (isSubmitting) return
        if (requiresInput) {
            if (inputValue !== requiresInput) {
                // Distinct message when the user got the letters right but the case
                // wrong — otherwise "type DELETE" silently rejects "Delete" with the
                // same prompt and looks broken.
                const caseMismatch = inputValue.toLowerCase() === requiresInput.toLowerCase()
                setInputError(
                    caseMismatch
                        ? `Please type "${requiresInput}" exactly (case-sensitive)`
                        : `Please type "${requiresInput}" to confirm`
                )
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
    }, [isSubmitting, requiresInput, inputValue, onConfirm])

    // ⌘↵ (or Ctrl+↵) keyboard shortcut to confirm — mirrors the visible
    // <Kbd> hint so keyboard-fluent users can confirm without mousing.
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleConfirm()
        }
    }, [handleConfirm])

    useEffect(() => {
        if (!isOpen) return
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, handleKeyDown])

    // Map ConfirmModal's danger/warning/info variants onto Modal's
    // gradient-header variants. Modal supports the same vocabulary so the
    // mapping is 1:1.
    const buttonVariant = variant === 'danger'
        ? 'danger'
        : variant === 'warning'
            ? 'warning'
            : 'primary'

    const footer = (
        <ModalFooter align="right">
            <Button variant="ghost" onClick={onClose} disabled={isLoading || isSubmitting} aria-label={cancelText} className="inline-flex items-center gap-2">
                {cancelText} <Kbd>Esc</Kbd>
            </Button>
            <Button variant={buttonVariant} onClick={handleConfirm} disabled={isLoading || isSubmitting} aria-label={(isLoading || isSubmitting) ? 'Processing...' : confirmText} className="inline-flex items-center gap-2">
                {(isLoading || isSubmitting) ? 'Processing...' : confirmText} <Kbd modifier="mod" tone="onSolid">↵</Kbd>
            </Button>
        </ModalFooter>
    )

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            variant={variant}
            icon={icon}
            iconGradient="none"
            size="sm"
            mobileVariant="center"
            footer={footer}
        >
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

            {requiresInput && (
                <div className="mt-4">
                    <label htmlFor="confirm-input" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Type <span className="font-semibold text-red-600 dark:text-red-400">{requiresInput}</span> to confirm:
                        <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">(case-sensitive)</span>
                    </label>
                    <input
                        id="confirm-input"
                        type="text"
                        value={inputValue}
                        onChange={(e) => { setInputValue(e.target.value); setInputError(''); }}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-[color:var(--ds-accent-brand)] focus:border-[color:var(--ds-accent-brand)]"
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
        </Modal>
    )
}
