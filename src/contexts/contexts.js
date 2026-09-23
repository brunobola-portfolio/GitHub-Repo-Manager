import { createContext } from 'react'

export const ModalContext = createContext(null)
export const SelectionContext = createContext(null)
export const ToastContext = createContext(null)
// The toast list lives apart from the actions: every push and auto-dismiss
// changes it, and the ~55 components that only fire toasts must not
// re-render for that.
export const ToastListContext = createContext(null)
export const TrackedReposContext = createContext(null)
// Defaults to 'free' so consumers don't have to null-guard the tier
// before the license endpoint resolves.
export const TierContext = createContext('free')
