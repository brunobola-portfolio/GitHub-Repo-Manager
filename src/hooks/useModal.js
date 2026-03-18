import { useContext } from 'react'
import { ModalContext } from '../contexts/ModalContext'

/**
 * Hook to access modal context
 * @returns {import('../contexts/ModalContext').ModalContextValue}
 * @throws {Error} If used outside ModalProvider
 */
export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within ModalProvider')
  }
  return context
}
