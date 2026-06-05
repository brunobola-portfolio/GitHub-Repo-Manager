import { Modal } from '../ui/Modal'
import { Sparkles } from 'lucide-react'
import { PolishReview } from './PolishReview'

/**
 * Modal entry point for the AI Polish flow. Receives `repoFullNames` from
 * ModalContext data; `onAppliedRepo` is wired by App.jsx to the global
 * patchRepoEverywhere helper so applied descriptions reflect in repo lists
 * the moment the row finishes.
 *
 * Phase A scope — see docs/specs/2026-05-08-post-migration-ai-polish.md.
 */
export function AIPolishModal({ isOpen, onClose, repoFullNames = [], onAppliedRepo }) {
    if (!Array.isArray(repoFullNames) || repoFullNames.length === 0) {
        // Defensive: nothing to show. Render nothing so accidental opens
        // don't flash an empty modal.
        return null
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Polish ${repoFullNames.length} repo${repoFullNames.length === 1 ? '' : 's'} with AI`}
            subtitle="Suggestions generated in batch from each repo's README and language."
            icon={Sparkles}
            iconGradient="primary"
            size="2xl"
            mobileVariant="sheet"
            closeOnBackdrop={false}
        >
            <PolishReview
                repoFullNames={repoFullNames}
                onAppliedRepo={onAppliedRepo}
                onRequestClose={onClose}
            />
        </Modal>
    )
}
