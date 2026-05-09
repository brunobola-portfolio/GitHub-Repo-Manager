import { Modal } from '../ui/Modal'
import { Sparkles } from 'lucide-react'

/**
 * Right-edge slide-in drawer for the AI Deep Review panel. Visible at
 * md and below, replacing the `hidden lg:flex` AI column that previously
 * left mobile users with no AI affordance at all.
 *
 * Both the desktop column and this drawer typically render the same
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
