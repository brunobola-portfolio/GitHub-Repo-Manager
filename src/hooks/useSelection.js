import { useContext } from 'react'
import { SelectionContext } from '../contexts/contexts'

/**
 * Hook to access selection context
 * @returns {import('../contexts/SelectionContext').SelectionContextValue}
 * @throws {Error} If used outside SelectionProvider
 */
export function useSelection() {
  const context = useContext(SelectionContext)
  if (!context) {
    throw new Error('useSelection must be used within SelectionProvider')
  }
  return context
}
