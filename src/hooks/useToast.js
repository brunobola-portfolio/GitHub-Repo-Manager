import { useContext } from 'react'
import { ToastContext } from '../contexts/contexts'

/**
 * useToast — read the shared toast context.
 * Returns: { toast, toasts, dismissToast }
 */
export function useToast() {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within a <ToastProvider>')
    }
    return ctx
}
