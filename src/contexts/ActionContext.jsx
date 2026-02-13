import { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * @typedef {Object} ActionResult
 * @property {string} repoId - Repository ID
 * @property {boolean} success - Whether action succeeded
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} ActionContextValue
 * @property {boolean} isPerforming - Whether an action is currently in progress
 * @property {ActionResult[]} actionResults - Results from the last batch action
 * @property {(actionType: string, repoIds: string[]) => Promise<void>} performAction - Execute action on repos
 * @property {() => void} clearResults - Clear action results
 */

const ActionContext = createContext(null)

/**
 * ActionProvider - Manages bulk repository actions
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function ActionProvider({ children }) {
  const [isPerforming, setIsPerforming] = useState(false)
  const [actionResults, setActionResults] = useState([])

  /**
   * Perform a bulk action on multiple repositories
   * @param {string} actionType - Type of action (archive, delete, star, etc.)
   * @param {string[]} repoIds - Array of repository IDs to act on
   */
  const performAction = useCallback(async (actionType, repoIds) => {
    setIsPerforming(true)
    setActionResults([])

    try {
      const results = []

      for (const repoId of repoIds) {
        try {
          // Make API call for each repo
          const response = await fetch(`/api/repos/${repoId}/${actionType}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            const error = await response.text()
            results.push({
              repoId,
              success: false,
              error: error || 'Action failed',
            })
          } else {
            results.push({
              repoId,
              success: true,
            })
          }
        } catch (error) {
          results.push({
            repoId,
            success: false,
            error: error.message || 'Network error',
          })
        }
      }

      setActionResults(results)
    } catch (error) {
      console.error('Error performing action:', error)
    } finally {
      setIsPerforming(false)
    }
  }, [])

  /**
   * Clear action results
   */
  const clearResults = useCallback(() => {
    setActionResults([])
  }, [])

  const value = useMemo(
    () => ({
      isPerforming,
      actionResults,
      performAction,
      clearResults,
    }),
    [isPerforming, actionResults, performAction, clearResults]
  )

  return <ActionContext.Provider value={value}>{children}</ActionContext.Provider>
}

/**
 * Hook to access action context
 * @returns {ActionContextValue}
 * @throws {Error} If used outside ActionProvider
 */
export function useAction() {
  const context = useContext(ActionContext)
  if (!context) {
    throw new Error('useAction must be used within ActionProvider')
  }
  return context
}
