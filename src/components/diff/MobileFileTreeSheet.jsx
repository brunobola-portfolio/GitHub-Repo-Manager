import { Modal } from '../ui/Modal'
import { FileTree } from '../PRReview/FileTree/FileTree'
import { Files } from 'lucide-react'

/**
 * Mobile bottom-sheet wrapper around <FileTree>. Used by CodeReviewSurface
 * below the `md` breakpoint where there is no room for a 220px left column.
 *
 * Selecting a file forwards to the consumer's onFileSelect and dismisses
 * the sheet — mirroring iOS Settings drilling.
 */
export function MobileFileTreeSheet({
    isOpen,
    onClose,
    files,
    activeFile,
    reviewedFiles,
    aiFileRisks,
    onFileSelect,
    restoreFocusRef,
}) {
    const handleSelect = (filename) => {
        onFileSelect?.(filename)
        onClose?.()
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Files (${files?.length ?? 0})`}
            icon={Files}
            iconGradient="primary"
            size="lg"
            mobileVariant="sheet"
            bodyClassName="!p-0"
            restoreFocusRef={restoreFocusRef}
        >
            <FileTree
                files={files ?? []}
                activeFile={activeFile}
                reviewedFiles={reviewedFiles ?? []}
                aiFileRisks={aiFileRisks ?? []}
                onFileSelect={handleSelect}
            />
        </Modal>
    )
}
