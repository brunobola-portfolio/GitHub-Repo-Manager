import { useState, useId } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, ModalFooter } from '../../../ui/Modal'
import { Input } from '../../../ui/form'

/**
 * Destructive confirmation for the "Replace" conflict action. Replacing a
 * non-empty target deletes the repo on GitHub (issues, PRs, stars, settings),
 * so the confirm button stays disabled until the user types the exact repo
 * full name — the standard guard for irreversible actions.
 *
 * @param {{ isOpen:boolean, repoFullName:string, onCancel:Function, onConfirm:Function }} props
 */
export function ReplaceConfirmModal({ isOpen, repoFullName, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const inputId = useId()

  const matches = typed.trim() === repoFullName

  function handleCancel() {
    setTyped('')
    onCancel()
  }

  function handleConfirm() {
    setTyped('')
    onConfirm()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Replace existing repository?"
      variant="danger"
      icon={AlertTriangle}
      size="md"
      footer={
        <ModalFooter align="between">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
              text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-white/5
              border border-slate-200/60 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10
              ds-focus-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches}
            onClick={handleConfirm}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors ds-focus-ring
              ${matches ? 'bg-rose-600 hover:bg-rose-700' : 'bg-rose-600/40 cursor-not-allowed'}`}
          >
            Delete &amp; Replace
          </button>
        </ModalFooter>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          This will <strong>permanently delete</strong>{' '}
          <span className="font-semibold text-rose-600 dark:text-rose-400">{repoFullName}</span>{' '}
          on GitHub — including its issues, pull requests, stars and settings — and recreate it
          from the source. <strong>This cannot be undone.</strong>
        </p>
        <div>
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
          >
            Type the repository name{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">{repoFullName}</span>{' '}
            to confirm
          </label>
          <Input
            id={inputId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={repoFullName}
            status={typed && !matches ? 'error' : 'idle'}
            autoFocus
          />
        </div>
      </div>
    </Modal>
  )
}
