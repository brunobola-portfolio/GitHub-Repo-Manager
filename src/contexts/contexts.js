import { createContext } from 'react'

export const ModalContext = createContext(null)
export const SelectionContext = createContext(null)
export const ToastContext = createContext(null)
export const TrackedReposContext = createContext(null)
// Defaults to 'free' so consumers don't have to null-guard the tier
// before the license endpoint resolves.
export const TierContext = createContext('free')
