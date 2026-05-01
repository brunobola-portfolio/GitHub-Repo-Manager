import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

export function MobileDrawer({ isOpen, onClose, children, side = 'right' }) {
  const isLeft = side === 'left'
  const isBottom = side === 'bottom'
  const drawerRef = useFocusTrap(isOpen, onClose)
  useBodyScrollLock(isOpen)

  // Position + slide animation depend on side.
  const positionClasses = isBottom
    ? 'bottom-0 inset-x-0 max-h-[80vh] rounded-t-2xl'
    : `${isLeft ? 'left-0' : 'right-0'} top-0 bottom-0 w-80 max-w-[90vw]`

  const initial = isBottom
    ? { y: '100%' }
    : { x: isLeft ? '-100%' : '100%' }
  const exit = initial
  const animate = isBottom ? { y: 0 } : { x: 0 }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-50 xl:hidden backdrop-blur-sm"
            aria-label="Close drawer"
          />

          {/* Drawer */}
          <motion.div
            ref={drawerRef}
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`fixed ${positionClasses} bg-white dark:bg-slate-900 z-50 shadow-2xl overflow-y-auto`}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation drawer"
          >
            {/* Close button */}
            <div className={`sticky top-0 ${isBottom ? '' : 'right-0'} p-4 flex justify-end bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800`}>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close navigation drawer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
