import { ConfirmModal } from '../ui/ConfirmModal'

/**
 * ConfirmCloseModal — the wizard's dirty-close confirmation. Owns the
 * step-dependent warning copy (an in-progress migration warns that closing
 * loses visibility but doesn't stop the run; any other step warns about
 * losing unsaved progress) and wraps the shared ConfirmModal with the
 * wizard's fixed title/labels/variant. The open/close orchestration
 * (showConfirm state, handleClose decision) stays in MigrationWizard.
 *
 * @param {boolean} isOpen
 * @param {string} currentStep      drives the warning message
 * @param {() => void} onCancel     "Continue Editing" / dismiss
 * @param {() => void} onConfirm    "Discard & Close"
 */
export default function ConfirmCloseModal({ isOpen, currentStep, onCancel, onConfirm }) {
  const message = currentStep === 'progress'
    ? 'A migration is in progress. Closing will not stop it, but you will lose visibility of the progress. Are you sure?'
    : 'You have unsaved progress. All entered data will be lost.'

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Cancel Migration?"
      message={message}
      confirmText="Discard & Close"
      cancelText="Continue Editing"
      variant="warning"
    />
  )
}
