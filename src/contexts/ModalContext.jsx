import { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * @typedef {Object} ModalStates
 * @property {boolean} showAzureImport - Azure DevOps import modal
 * @property {boolean} showCreateRepo - Create repository modal
 * @property {boolean} showTransfer - Transfer repository modal
 * @property {boolean} showOrgManager - Organization manager modal
 * @property {boolean} showCommitGen - Commit generator modal
 * @property {boolean} showRepoInsights - Repository insights modal
 * @property {boolean} showActionsStats - GitHub Actions stats modal
 * @property {boolean} showCommunityHealth - Community health modal
 */

/**
 * @typedef {Object} ModalContextValue
 * @property {ModalStates} modalStates - Current state of all modals
 * @property {(modalName: keyof ModalStates) => void} openModal - Open a specific modal
 * @property {(modalName: keyof ModalStates) => void} closeModal - Close a specific modal
 * @property {(modalName: keyof ModalStates) => void} toggleModal - Toggle a specific modal
 * @property {() => void} closeAllModals - Close all modals at once
 */

const ModalContext = createContext(null)

/**
 * ModalProvider - Manages all modal states in the application
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function ModalProvider({ children }) {
  const [modalStates, setModalStates] = useState({
    showAzureImport: false,
    showCreateRepo: false,
    showTransfer: false,
    showOrgManager: false,
    showCommitGen: false,
    showRepoInsights: false,
    showActionsStats: false,
    showCommunityHealth: false,
  })

  /**
   * Open a specific modal
   * @param {keyof ModalStates} modalName
   */
  const openModal = useCallback((modalName) => {
    setModalStates((prev) => ({
      ...prev,
      [modalName]: true,
    }))
  }, [])

  /**
   * Close a specific modal
   * @param {keyof ModalStates} modalName
   */
  const closeModal = useCallback((modalName) => {
    setModalStates((prev) => ({
      ...prev,
      [modalName]: false,
    }))
  }, [])

  /**
   * Toggle a specific modal
   * @param {keyof ModalStates} modalName
   */
  const toggleModal = useCallback((modalName) => {
    setModalStates((prev) => ({
      ...prev,
      [modalName]: !prev[modalName],
    }))
  }, [])

  /**
   * Close all modals at once
   */
  const closeAllModals = useCallback(() => {
    setModalStates({
      showAzureImport: false,
      showCreateRepo: false,
      showTransfer: false,
      showOrgManager: false,
      showCommitGen: false,
      showRepoInsights: false,
      showActionsStats: false,
      showCommunityHealth: false,
    })
  }, [])

  const value = useMemo(
    () => ({
      modalStates,
      openModal,
      closeModal,
      toggleModal,
      closeAllModals,
    }),
    [modalStates, openModal, closeModal, toggleModal, closeAllModals]
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
