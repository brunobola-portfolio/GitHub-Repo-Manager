import { useEffect } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { TabBar } from './TabBar'

const ICON_GRADIENT_CLASSES = {
    none:    'bg-white/15',
    primary: 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25',
    premium: 'bg-gradient-to-br from-indigo-500 via-cyan-500 to-pink-500 shadow-lg shadow-purple-500/25',
    success: 'bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/25',
}

const STAGGER_VARIANTS = {
    hidden:  {},
    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
}

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
}) {
    const sizeClasses = {
        sm:    'max-w-md',
        md:    'max-w-lg',
        lg:    'max-w-2xl',
        xl:    'max-w-4xl',
        '2xl': 'max-w-5xl',
        '3xl': 'max-w-6xl',
        full:  'max-w-7xl'
    }

    const variantStyles = {
        default: {
            headerBg: 'bg-gradient-to-r from-indigo-500 to-purple-600',
            iconBg: 'bg-white/20',
            textColor: 'text-white'
        },
        danger: {
            headerBg: 'bg-gradient-to-r from-red-500 to-rose-600',
            iconBg: 'bg-white/20',
            textColor: 'text-white'
        },
        warning: {
            headerBg: 'bg-gradient-to-r from-amber-500 to-orange-600',
            iconBg: 'bg-white/20',
            textColor: 'text-white'
        },
        info: {
            headerBg: 'bg-gradient-to-r from-blue-500 to-cyan-600',
            iconBg: 'bg-white/20',
            textColor: 'text-white'
        },
        success: {
            headerBg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
            iconBg: 'bg-white/20',
            textColor: 'text-white'
        }
    }

    const styles = variantStyles[variant] || variantStyles.default

    const modalRef = useFocusTrap(isOpen, onClose)
    useBodyScrollLock(isOpen)

    const handleBackdropClick = (e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
            onClose()
        }
    }

    // Scroll input into view when keyboard appears (mobile fix)
    useEffect(() => {
        if (!isOpen) return

        const handleFocus = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300) // Delay for keyboard animation
            }
        }

        const modal = modalRef.current
        modal?.addEventListener('focusin', handleFocus)

        return () => {
            modal?.removeEventListener('focusin', handleFocus)
        }
    }, [isOpen, modalRef])

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleBackdropClick}
                        className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4"
                    >
                        {/* Modal Container */}
                        <motion.div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="modal-title"
                            aria-describedby="modal-body"
                            initial={{ opacity: 0, scale: 0.98, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: 24 }}
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }}
                            onClick={(e) => e.stopPropagation()}
                            className={`
                                ${sizeClasses[size]}
                                w-full min-w-[320px]
                                bg-white dark:bg-slate-950
                                rounded-2xl
                                shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)]
                                ring-1 ring-slate-200/50 dark:ring-slate-700/50
                                overflow-hidden
                                flex flex-col
                                max-h-[85vh] md:max-h-[90vh]
                                ${className}
                            `}
                        >
                            {/* Header */}
                            <div className={`${styles.headerBg} ${styles.textColor} flex-shrink-0 flex items-center h-12 md:h-[52px] px-4 md:px-5 gap-3`}>
                                {Icon && (
                                    <div
                                        data-icon-tile="true"
                                        className={`${ICON_GRADIENT_CLASSES[iconGradient] || ICON_GRADIENT_CLASSES.none} p-1.5 rounded-lg`}
                                    >
                                        <Icon className="w-6 h-6" strokeWidth={2.5} />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    {typeof title === 'string' ? (
                                        <h2 id="modal-title" className="text-sm font-semibold tracking-tight truncate">
                                            {title}
                                        </h2>
                                    ) : (
                                        title
                                    )}
                                    {subtitle && (
                                        <p className="text-[11px] text-white/70 truncate mt-0.5">
                                            {subtitle}
                                        </p>
                                    )}
                                </div>
                                {showCloseButton && (
                                    <button
                                        onClick={onClose}
                                        className="p-2 hover:bg-white/15 rounded-lg transition-all duration-200 flex-shrink-0"
                                        aria-label="Close modal"
                                    >
                                        <X className="w-4 h-4" strokeWidth={2} />
                                    </button>
                                )}
                            </div>
                            {tabs && tabs.length > 0 && (
                                <div className="flex-shrink-0 px-4 md:px-5 bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200/50 dark:border-slate-800/40">
                                    <TabBar
                                        tabs={tabs}
                                        activeTab={activeTab}
                                        onTabChange={onTabChange}
                                        variant="underline"
                                        layoutId={tabsLayoutId || 'modal-tabs'}
                                        size="md"
                                    />
                                </div>
                            )}

                            {/* Body */}
                            <div id="modal-body" className={`flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/30 dark:bg-slate-950 ${bodyClassName}`}>
                                {staggerChildren ? (
                                    <motion.div
                                        data-stagger-root="true"
                                        variants={STAGGER_VARIANTS}
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
                                <div className="flex-shrink-0 flex items-center min-h-[72px] px-6 md:px-8 bg-white/80 dark:bg-slate-900/70 ds-glass border-t border-slate-200/50 dark:border-slate-800/40">
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
