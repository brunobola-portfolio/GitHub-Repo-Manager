import { AnimatePresence, motion } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

const EASE = [0.16, 1, 0.3, 1]

export function Sheet({ open, onOpenChange, title, children }) {
    const close = () => onOpenChange(false)
    const panelRef = useFocusTrap(open, close)
    useBodyScrollLock(open)

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        data-testid="sheet-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={close}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                        aria-hidden="true"
                    />
                    <motion.aside
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={title || 'Sheet'}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-700/50 rounded-t-2xl shadow-2xl p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom,0px))]"
                    >
                        <div aria-hidden="true" className="w-12 h-1 rounded-full bg-slate-300 dark:bg-slate-600 mx-auto mb-4" />
                        {title && (
                            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display mb-3">
                                {title}
                            </h2>
                        )}
                        {children}
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
