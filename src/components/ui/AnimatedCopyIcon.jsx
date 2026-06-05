import { AnimatePresence, motion } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { TRANSITION } from './motion'

/**
 * Copy ↔ Check icon with a subtle animated swap (the confirmation pops in).
 *
 * Drop-in replacement for the ubiquitous `copied ? <Check/> : <Copy/>` ternary
 * inside copy-to-clipboard buttons, so every copy affordance confirms the same
 * premium way instead of snapping. Decorative — keep the real label on the
 * surrounding button (this is aria-hidden).
 *
 * Reduced motion is handled globally by <MotionConfig reducedMotion="user">
 * (the scale transform is dropped, leaving a clean cross-fade).
 *
 * @param {boolean} copied        current copied state
 * @param {string}  [size]        size utility applied to both icons (default w-3.5 h-3.5)
 * @param {string}  [copyClassName]  extra classes for the idle Copy icon (e.g. tone)
 * @param {string}  [checkClassName] extra classes for the Check icon (e.g. emerald tone)
 */
export function AnimatedCopyIcon({ copied, size = 'w-3.5 h-3.5', copyClassName = '', checkClassName = '' }) {
  const Icon = copied ? Check : Copy
  const tone = copied ? checkClassName : copyClassName
  return (
    <span className="inline-flex" aria-hidden="true">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={copied ? 'check' : 'copy'}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={TRANSITION.fast}
          className="inline-flex"
        >
          <Icon className={`${size} ${tone}`} />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
