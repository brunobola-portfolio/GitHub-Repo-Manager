import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

const SPRING = { type: 'spring', damping: 28, stiffness: 280, mass: 1 }
const REDUCED_TRANSITION = { duration: 0.12 }

const ENTER_VARIANTS = {
    left: { hidden: { x: '-100%' }, show: { x: 0 } },
    right: { hidden: { x: '100%' }, show: { x: 0 } },
    bottom: { hidden: { y: '100%' }, show: { y: 0 } },
}

const POSITION_CLASSES = {
    left: 'left-0 top-0 h-full',
    right: 'right-0 top-0 h-full',
    bottom: 'left-0 right-0 bottom-0 max-h-[85vh] rounded-t-2xl',
}

/**
 * Unified Drawer primitive. Replaces Sheet, MobileDrawer, SidePanel, and the
 * bespoke AutoFixDrawer motion shell.
 *
 * Props:
 *   isOpen, onClose                          — required
 *   side: 'left'|'right'|'bottom'            — default 'right'
 *   title?, subtitle?, icon?                 — header (icon shown as gradient tile)
 *   footer?                                  — sticky footer slot
 *   width?: number                           — px, applies to side='left'|'right' only (default 480)
 *   mobileOnly?: boolean                     — hide via 'xl:hidden' (preserve old MobileDrawer behavior)
 *   showCloseButton?: boolean                — default true
 *   showDragHandle?: boolean                 — default true for side='bottom', else false
 *   swipeToDismiss?: boolean                 — drag-y to close (bottom only); default true on bottom
 *   closeOnBackdrop?: boolean                — clicking the dimmed area dismisses (default true);
 *                                              set to false on drawers that hold edit state
 *                                              (forms, multi-step pickers) so an accidental
 *                                              click outside the panel can't discard the user's
 *                                              progress. The X button and Escape always work.
 *   className?: string
 *   children
 */
export function Drawer({
    isOpen,
    onClose,
    side = 'right',
    title,
    subtitle,
    icon: Icon,
    footer,
    width = 480,
    mobileOnly = false,
    showCloseButton = true,
    showDragHandle,
    swipeToDismiss,
    closeOnBackdrop = true,
    className = '',
    children,
}) {
    const reduced = useReducedMotion()
    const containerRef = useFocusTrap(isOpen, onClose)
    useBodyScrollLock(isOpen)

    const isBottom = side === 'bottom'
    const dragHandleOn = showDragHandle ?? isBottom
    const swipeOn = swipeToDismiss ?? isBottom
    const sizeStyle = isBottom ? undefined : { width: `min(${width}px, 100vw)` }

    return (
        <AnimatePresence>
            {isOpen ? (
                <>
                    {/* Backdrop */}
                    <motion.div
                        data-testid="drawer-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={reduced ? REDUCED_TRANSITION : { duration: 0.18 }}
                        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[var(--ds-z-modal)] ${mobileOnly ? 'xl:hidden' : ''}`}
                        onClick={closeOnBackdrop ? onClose : undefined}
                        aria-hidden="true"
                    />
                    {/* Panel */}
                    <motion.aside
                        ref={containerRef}
                        data-testid="drawer-panel"
                        data-side={side}
                        role="dialog"
                        aria-modal="true"
                        aria-label={typeof title === 'string' ? title : undefined}
                        initial="hidden"
                        animate="show"
                        exit="hidden"
                        variants={ENTER_VARIANTS[side]}
                        transition={reduced ? REDUCED_TRANSITION : SPRING}
                        drag={swipeOn ? 'y' : false}
                        dragConstraints={swipeOn ? { top: 0, bottom: 0 } : undefined}
                        dragElastic={swipeOn ? 0.18 : 0}
                        onDragEnd={swipeOn ? (_e, info) => {
                            if (info.offset.y > 100 || info.velocity.y > 500) onClose()
                        } : undefined}
                        style={{
                            ...sizeStyle,
                            paddingBottom: isBottom ? 'env(safe-area-inset-bottom, 0px)' : undefined,
                        }}
                        className={`fixed z-[var(--ds-z-modal)] flex flex-col bg-white dark:bg-gray-900 shadow-2xl ${POSITION_CLASSES[side]} ${mobileOnly ? 'xl:hidden' : ''} ${className}`}
                    >
                        {dragHandleOn ? (
                            <div className="flex justify-center pt-2 pb-1 shrink-0" aria-hidden="true">
                                <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                            </div>
                        ) : null}
                        {(title || subtitle || Icon || showCloseButton) ? (
                            <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                                {Icon ? (
                                    <span className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shadow-sm">
                                        <Icon className="w-4 h-4" aria-hidden="true" />
                                    </span>
                                ) : null}
                                <div className="flex-1 min-w-0">
                                    {title ? (
                                        <h2 className="ds-font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">{title}</h2>
                                    ) : null}
                                    {subtitle ? (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
                                    ) : null}
                                </div>
                                {showCloseButton ? (
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        aria-label="Close"
                                        className="shrink-0 w-8 h-8 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
                                    >
                                        <X className="w-4 h-4" aria-hidden="true" />
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
                        {footer ? (
                            <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 shrink-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
                                {footer}
                            </div>
                        ) : null}
                    </motion.aside>
                </>
            ) : null}
        </AnimatePresence>
    )
}
