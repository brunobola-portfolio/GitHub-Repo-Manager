// Re-export from the canonical context location.
// The old plain-hook implementation has been replaced by ToastContext so that
// all components share a single toasts array and reach the one <ToastContainer>.
export { useToast } from '../contexts/ToastContext'
