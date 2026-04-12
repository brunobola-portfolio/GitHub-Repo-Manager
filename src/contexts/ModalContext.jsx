import { useState, useCallback, useMemo } from 'react'
import { ModalContext } from './contexts'

const MODAL_NAMES = [
  'showCreateRepo',
  'showTransfer',
  'showOrgManager',
  'showCommitGen',
  'showRepoInsights',
  'showCommunityHealth',
  'showSettings',
  'showMigrationWizard',
  'showMigrationHistory',
  'showConfirm',
  'showBatchIndex',
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
   * Close a specific modal but keep its data so exit animations still render correctly.
   * Data is cleared when a new modal opens or when closeAllModals is called.
   * @param {string} modalName
   */
  const closeModal = useCallback((modalName) => {
    setInternalStates((prev) => ({
      ...prev,
      [modalName]: { ...prev[modalName], isOpen: false },
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