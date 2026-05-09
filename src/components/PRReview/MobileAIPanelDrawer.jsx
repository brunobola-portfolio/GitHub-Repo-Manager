import { Modal } from '../ui/Modal'
import { Sparkles } from 'lucide-react'

/**
 * Bottom sheet for the AI Deep Review panel on mobile/tablet. Visible at
 * md and below, replacing the `hidden lg:flex` AI column that previously
 * left mobile users with no AI affordance at all.
 *
 * Inherits Modal's `mobileVariant="sheet"` slide-up animation. The earlier
 * "right-edge drawer" naming was aspirational — bottom sheets fight iOS
 * swipe-back gestures less, so we kept the bottom-sheet motion. Rename
 * to MobileAIPanelSheet in a future cleanup if the file gets renamed.
 *
 * Both the desktop column and this sheet typically render the same
 * <AIReviewPanel> backed by the same useAIDeepReview hook instance,
 * so state stays consistent across the two mounts.
 */
export function MobileAIPanelDrawer({ isOpen, onClose, children }) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="AI insights"
            icon={Sparkles}
            iconGradient="premium"
            size="lg"
            mobileVariant="sheet"
            bodyClassName="!p-0"
        >
            {children}
        </Modal>
    )
}
