import { useId } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useMobileKeyboardFix } from '../../hooks/useMobileKeyboardFix'
import { TabBar } from './TabBar'

// Per non-LLM theme (docs/specs/2026-05-14-premium-non-llm-theme-design.md),
// modal headers are GitHub-utilitarian: neutral surface, dark text, border-b.
// Variant state (danger/warning/info/success) and iconGradient (primary/success
// affordance) are communicated through the icon tile's soft-tinted background
// instead of a colored header. `iconGradient="none"` falls through to the
// variant-derived tile color.
const ICON_GRADIENT_CLASSES = {
    none:    null,
    primary: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

const VARIANT_ICON_STYLES = {
    default: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    danger:  'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    info:    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

const STAGGER_VARIANTS = {
    hidden:  {},
    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
}

// Static lookup tables so Tailwind's JIT scanner can discover every class.
// IMPORTANT: never build these at runtime (e.g. `md:${sizeClasses[size]}`) —
// Tailwind only picks up complete, static class names in source.
// Wide tiers (`2xl`, `3xl`) use viewport-aware sizing so big displays stop
// leaving hundreds of pixels of dead space around the dialog. Caps are still
// in place so the modal never goes edge-to-edge — premium dialogs stay
// readable and visually contained even on ultrawide monitors.
const SIZE_CLASSES = {
    sm:    'max-w-md',
    md:    'max-w-lg',
    lg:    'max-w-2xl',
    xl:    'max-w-4xl',
    '2xl': 'max-w-[min(90vw,1200px)]',
    '3xl': 'max-w-[min(92vw,1440px)]',
    full:  'max-w-[min(96vw,1600px)] max-h-[92vh]',
}

const SHEET_SIZE_CLASSES = {
    sm:    'md:max-w-md',
    md:    'md:max-w-lg',
    lg:    'md:max-w-2xl',
    xl:    'md:max-w-4xl',
    '2xl': 'md:max-w-[min(90vw,1200px)]',
    '3xl': 'md:max-w-[min(92vw,1440px)]',
    full:  'md:max-w-[min(96vw,1600px)] md:max-h-[92vh]',
}

// All variants share the same neutral header (GitHub Primer-style). Semantic
// state is conveyed by the icon tile color via VARIANT_ICON_STYLES above.
const HEADER_CLASS = 'border-b border-slate-200 dark:border-[color:var(--ds-border-dark)] text-slate-900 dark:text-slate-100'

/**
 * Modal - Premium base modal component with consistent styling
 * Provides a standardized modal experience across the app with glassmorphism and animations
 */
export function Modal({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    footer,
    size = 'md', // 'sm', 'md', 'lg', 'xl'
    variant = 'default', // 'default', 'danger', 'warning', 'info', 'success'
    icon: Icon,
    closeOnBackdrop = true,
    showCloseButton = true,
    className = '',
    tabs,
    activeTab,
    onTabChange,
    tabsLayoutId,
    staggerChildren = false,
    iconGradient = 'none',
    bodyClassName = '',
    mobileVariant = 'sheet',
    // Disable Escape-to-close. Defaults to true whenever backdrop click is
    // also disabled (e.g. mid-running TransferModal) so both dismissal
    // vectors are protected together. Callers can override explicitly.
    disableEscape = !closeOnBackdrop,
    // Signal that async content is loading — forwarded to the body's aria-busy
    // so screen readers hear a "busy" state while skeletons show.
    isBusy = false,
    // Optional refs for focus management — see useFocusTrap docs. Most
    // modals don't need these (the focus trap defaults to first-focusable
    // → close-X, restore to whatever opened the modal). Sheets that want
    // to land focus on a specific row, or that are opened by a FAB which
    // unmounts when the sheet opens, can override.
    initialFocusRef,
    restoreFocusRef,
    ...rest
}) {
    // Use module-level lookup tables so Tailwind's JIT discovers every class.
    const sizeClass = (mobileVariant === 'sheet' ? SHEET_SIZE_CLASSES[size] : SIZE_CLASSES[size]) || SIZE_CLASSES.md
    const iconTileClass = ICON_GRADIENT_CLASSES[iconGradient] || VARIANT_ICON_STYLES[variant] || VARIANT_ICON_STYLES.default

    const modalRef = useFocusTrap(isOpen, onClose, { disableEscape, initialFocusRef, restoreFocusRef })
    useBodyScrollLock(isOpen)
    useMobileKeyboardFix(isOpen, modalRef)
    const reducedMotion = useReducedMotion()

    const reactId = useId()
    const titleId = `modal-title-${reactId}`
    const bodyId = `modal-body-${reactId}`
    // Per-instance fallback so two modals with tabs that don't pass an
    // explicit tabsLayoutId don't collide on DOM tab/tabpanel ids.
    const effectiveTabsLayoutId = tabsLayoutId || `modal-tabs-${reactId}`

    const handleBackdropClick = (e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
            onClose()
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        data-modal-backdrop="true"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleBackdropClick}
                        className={`fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-[var(--ds-z-modal)] flex justify-center md:items-center md:p-4 ${mobileVariant === 'sheet' ? 'items-end p-0 short:items-center short:p-4' : 'items-center max-md:p-4'}`}
                    >
                        {/* Modal Container */}
                        <motion.div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            // Only set aria-describedby when the body still has bodyId.
                            // When tabs are active, the body div takes a tabpanel id
                            // instead (see below), so pointing at bodyId would orphan.
                            aria-describedby={tabs && tabs.length > 0 ? undefined : bodyId}
                            {...rest}
                            initial={reducedMotion ? { opacity: 0 } : (mobileVariant === 'sheet' ? { opacity: 0, y: '4%' } : { opacity: 0, scale: 0.98, y: 24 })}
                            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                            exit={reducedMotion ? { opacity: 0 } : (mobileVariant === 'sheet' ? { opacity: 0, y: '4%' } : { opacity: 0, scale: 0.98, y: 24 })}
                            transition={reducedMotion ? { duration: 0.15 } : { type: 'spring', duration: 0.4, bounce: 0.12 }}
                            onClick={(e) => e.stopPropagation()}
                            className={`
                                ${sizeClass}
                                w-full min-w-[320px]
                                bg-white dark:bg-[color:var(--ds-surface-dark)]
                                rounded-2xl
                                ${mobileVariant === 'sheet' ? 'max-md:rounded-t-3xl max-md:rounded-b-none max-md:max-w-none short:rounded-2xl short:max-w-[calc(100%-2rem)]' : ''}
                                shadow-[var(--ds-shadow-lg)]
                                ring-1 ring-slate-200/50 dark:ring-[color:var(--ds-border-dark)]
                                overflow-hidden
                                flex flex-col
                                max-h-[92vh] md:max-h-[88vh] short:max-h-[90vh]
                                ${tabs && tabs.length > 0 ? 'md:h-[min(86vh,920px)] short:h-auto' : ''}
                                ${className}
                            `}
                        >
                            {/* Header */}
                            <div className={`${HEADER_CLASS} flex-shrink-0 flex items-center h-12 md:h-[52px] px-4 md:px-5 gap-3`}>
                                {Icon && (
                                    <div
                                        data-icon-tile="true"
                                        className={`${iconTileClass} p-1.5 rounded-lg flex-shrink-0`}
                                    >
                                        {/* 28-px tile (w-4 icon + 1.5 padding) — uniform header rhythm
                                            across every popup primitive. Tile is soft-tinted, not solid. */}
                                        <Icon className="w-4 h-4" strokeWidth={2.5} />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    {typeof title === 'string' ? (
                                        <h2 id={titleId} className="text-sm font-semibold tracking-tight truncate">
                                            {title}
                                        </h2>
                                    ) : (
                                        title
                                    )}
                                    {subtitle && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                            {subtitle}
                                        </p>
                                    )}
                                </div>
                                {showCloseButton && (
                                    <button
                                        onClick={onClose}
                                        className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 flex-shrink-0 ds-focus-ring"
                                        aria-label="Close modal"
                                    >
                                        <X className="w-4 h-4" strokeWidth={2} />
                                    </button>
                                )}
                            </div>
                            {tabs && tabs.length > 0 && (
                                <div className="flex-shrink-0 px-4 md:px-5 bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200/50 dark:border-slate-800/40 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]">
                                    <TabBar
                                        tabs={tabs}
                                        activeTab={activeTab}
                                        onTabChange={onTabChange}
                                        variant="underline"
                                        layoutId={effectiveTabsLayoutId}
                                        size="md"
                                    />
                                </div>
                            )}

                            {/* Body — when the modal has tabs, give the body a stable
                                min-height so swapping between sparse and dense tabs
                                doesn't make the whole panel jump in size (which
                                feels unpolished, especially for Settings). */}
                            <div
                                id={tabs && tabs.length > 0 && activeTab ? `tabpanel-${effectiveTabsLayoutId}-${activeTab}` : bodyId}
                                role={tabs && tabs.length > 0 ? 'tabpanel' : undefined}
                                aria-labelledby={tabs && tabs.length > 0 && activeTab ? `tab-${effectiveTabsLayoutId}-${activeTab}` : undefined}
                                aria-busy={isBusy || undefined}
                                className={`flex-1 overflow-y-auto ds-modal-body ds-scrollbar bg-slate-50/30 dark:bg-[color:var(--ds-surface-dark)] ${tabs && tabs.length > 0 ? 'min-h-[400px] md:min-h-0' : ''} ${bodyClassName}`}
                            >
                                {staggerChildren ? (
                                    <motion.div
                                        data-stagger-root="true"
                                        variants={reducedMotion ? { hidden: {}, visible: {} } : STAGGER_VARIANTS}
                                        initial="hidden"
                                        animate="visible"
                                        key={activeTab || 'default'}
                                    >
                                        {children}
                                    </motion.div>
                                ) : (
                                    children
                                )}
                            </div>

                            {/* Footer */}
                            {footer && (
                                <div
                                    className={`flex-shrink-0 flex items-center min-h-[64px] md:min-h-[68px] px-4 md:px-5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[var(--ds-shadow-overlay)] ${mobileVariant === 'sheet' ? 'pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}
                                >
                                    <div className="w-full">
                                        {footer}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

/**
 * ModalFooter - Standardized footer layout for modal actions
 */
export function ModalFooter({ children, align = 'right' }) {
    const alignClasses = {
        left: 'justify-start',
        center: 'justify-center',
        right: 'justify-end',
        between: 'justify-between'
    }

    return (
        <div className={`flex items-center gap-3 ${alignClasses[align]}`}>
            {children}
        </div>
    )
}
