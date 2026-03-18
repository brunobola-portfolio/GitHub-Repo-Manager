import { createContext, useState, useCallback, useMemo } from 'react'

/**
 * @typedef {Object} SelectionContextValue
 * @property {Set<string>} selectedIds - Set of selected repository IDs
 * @property {(id: string) => void} toggleSelect - Toggle selection for a single repo
 * @property {(ids: string[]) => void} selectRepos - Select multiple repos
 * @property {(ids: string[]) => void} deselectRepos - Deselect multiple repos
 * @property {(allIds: string[]) => void} invertSelection - Invert selection given all available IDs
 * @property {() => void} clearSelection - Clear all selections
 */

export const SelectionContext = createContext(null)

/**
 * SelectionProvider - Manages repository selection state
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function SelectionProvider({ children }) {
  const [selectedIds, setSelectedIds] = useState(new Set())

  /**
   * Toggle selection for a single repository
   */
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  /**
   * Select multiple repositories at once
   */
  const selectRepos = useCallback((ids) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
  }, [])

  /**
   * Deselect multiple repositories at once
   */
  const deselectRepos = useCallback((ids) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  /**
   * Invert selection - select unselected, deselect selected
   */
  const invertSelection = useCallback((allIds) => {
    setSelectedIds((prev) => {
      const next = new Set()
      allIds.forEach((id) => {
        if (!prev.has(id)) {
          next.add(id)
        }
      })
      return next
    })
  }, [])

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const value = useMemo(
    () => ({
      selectedIds,
      toggleSelect,
      selectRepos,
      deselectRepos,
      invertSelection,
      clearSelection,
    }),
    [selectedIds, toggleSelect, selectRepos, deselectRepos, invertSelection, clearSelection]
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}