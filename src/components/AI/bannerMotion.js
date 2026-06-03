/**
 * Shared Framer Motion variants used by AI status banners.
 *
 * `BANNER_VARIANTS` is the canonical animated form (rise + fade); use
 * `BANNER_REDUCED_VARIANTS` when the user has `prefers-reduced-motion`.
 *
 * The `exit` keyframe is included so callers wrapping the banner in
 * `<AnimatePresence>` get a graceful out-animation. Banners that mount
 * permanently (e.g. WorkBoardCapReachedBanner) can simply ignore it.
 */

import { DURATION, EASE, TRANSITION } from '../ui/motion'

export const BANNER_VARIANTS = {
    hidden: { opacity: 0, y: -8 },
    visible: { opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE.emphasized } },
    exit: { opacity: 0, y: -4, transition: TRANSITION.fast },
}

export const BANNER_REDUCED_VARIANTS = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: DURATION.fast } },
    exit: { opacity: 0, transition: { duration: DURATION.instant } },
}
