import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

export function SidePanel({ isOpen, onClose, title, subtitle, children, width = 480, side = 'right' }) {
  const panelRef = useFocusTrap(isOpen, onClose)
  useBodyScrollLock(isOpen)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            data-testid="sidepanel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            aria-hidden="true"
          />
          <motion.aside
            ref={panelRef}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`fixed ${side === 'right' ? 'right-0' : 'left-0'} top-0 bottom-0 bg-white dark:bg-slate-950 z-50 shadow-2xl flex flex-col`}
            style={{ width: `min(${width}px, 100vw)` }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <header className="flex items-start justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold ds-gradient-text">{title}</h2>
                {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close panel"
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ds-focus-ring transition"
              >
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
