import { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * Internal modal state shape: { isOpen: boolean, data: any }
 * External consumers see `modalStates.showXxx` as a boolean for backward compat,
 * and can use `getModalData(modalName)` to read the payload.
 */

/**
 * @typedef {Object} ModalContextValue
 * @property {Object} modalStates - Current state of all modals (boolean properties for backward compat)
 * @property {(modalName: string) => void} openModal - Open a specific modal (no data)
 * @property {(modalName: string, data: any) => void} openModalWithData - Open a modal with payload data
 * @property {(modalName: string) => void} closeModal - Close a specific modal and clear its data
 * @property {(modalName: string) => void} toggleModal - Toggle a specific modal
 * @property {() => void} closeAllModals - Close all modals at once
 * @property {(modalName: string) => any} getModalData - Get the data payload for a specific modal
 */

const ModalContext = createContext(null)

const MODAL_NAMES = [
  'showAzureImport',
  'showCreateRepo',
  'showTransfer',
  'showOrgManager',
  'showCommitGen',
  'showRepoInsights',
  'showActionsStats',
  'showCommunityHealth',
  'showSettings',
  'showImportWizard',
  'showMigrationHistory',
  'showConfirm',
]

function createClosedState() {
  return { isOpen: false, data: null }
}

function createInitialInternalState() {
  const state = {}
  for (const name of MODAL_NAMES) {
    state[name] = createClosedState()
  }
  return state
}

/**
 * Build a backward-compatible boolean proxy from internal state.
 * `modalStates.showXxx` returns `true`/`false` (not the full object).
 */
function toBooleanStates(internalState) {
  const result = {}
  for (const key of Object.keys(internalState)) {
    result[key] = internalState[key].isOpen
  }
  return result
}

/**
 * ModalProvider - Manages all modal states in the application
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function ModalProvider({ children }) {
  const [internalStates, setInternalStates] = useState(createInitialInternalState)

  /**
   * Open a specific modal without data
   * @param {string} modalName
   */
  const openModal = useCallback((modalName) => {
    setInternalStates((prev) => ({
      ...prev,
      [modalName]: { isOpen: true, data: null },
    }))
  }, [])

  /**
   * Open a specific modal with payload data
   * @param {string} modalName
   * @param {any} data
   */
  const openModalWithData = useCallback((modalName, data) => {
    setInternalStates((prev) => ({
      ...prev,
      [modalName]: { isOpen: true, data },
    }))
  }, [])

  /**
   * Close a specific modal and reset its data
   * @param {string} modalName
   */
  const closeModal = useCallback((modalName) => {
    setInternalStates((prev) => ({
      ...prev,
      [modalName]: createClosedState(),
    }))
  }, [])

  /**
   * Toggle a specific modal
   * @param {string} modalName
   */
  const toggleModal = useCallback((modalName) => {
    setInternalStates((prev) => ({
      ...prev,
      [modalName]: prev[modalName]?.isOpen
        ? createClosedState()
        : { isOpen: true, data: null },
    }))
  }, [])

  /**
   * Close all modals at once
   */
  const closeAllModals = useCallback(() => {
    setInternalStates(createInitialInternalState())
  }, [])

  /**
   * Get the data payload for a specific modal
   * @param {string} modalName
   * @returns {any}
   */
  const getModalData = useCallback((modalName) => {
    return internalStates[modalName]?.data ?? null
  }, [internalStates])

  // Build backward-compatible boolean modalStates
  const modalStates = useMemo(() => toBooleanStates(internalStates), [internalStates])

  const value = useMemo(
    () => ({
      modalStates,
      openModal,
      openModalWithData,
      closeModal,
      toggleModal,
      closeAllModals,
      getModalData,
    }),
    [modalStates, openModal, openModalWithData, closeModal, toggleModal, closeAllModals, getModalData]
  )

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
}

/**
 * Hook to access modal context
 * @returns {ModalContextValue}
 * @throws {Error} If used outside ModalProvider
 */
export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within ModalProvider')
  }
  return context
}
