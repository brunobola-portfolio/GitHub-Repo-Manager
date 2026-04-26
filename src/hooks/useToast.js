import { useContext } from 'react'
import { ToastContext } from '../contexts/contexts'

// Silent no-op fallback used when the hook is called outside a
// <ToastProvider>. This is the right behaviour for tests that render a
// component in isolation (they shouldn't have to wire up ToastProvider
// just to import a component that happens to call useToast). The real
// app always has the provider mounted in main.jsx, so production
// behaviour is unchanged.
const NOOP = () => {}
const NOOP_TOAST = {
    success: NOOP,
    error: NOOP,
    info: NOOP,
    warning: NOOP,
    custom: NOOP,
    errorFromException: NOOP,
}
const FALLBACK_CTX = {
    toast: NOOP_TOAST,
    toasts: [],
    dismissToast: NOOP,
}

/**
 * useToast — read the shared toast context.
 * Returns: { toast, toasts, dismissToast }
 *
 * When there is no <ToastProvider> above in the tree (typical for
 * component unit tests), returns a no-op fallback so mounting a
 * component doesn't throw. Production always has a provider mounted.
 */
export function useToast() {
    const ctx = useContext(ToastContext)
    return ctx || FALLBACK_CTX
}
