import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/**
 * Modal - Premium base modal component with consistent styling
 * Provides a standardized modal experience across the app with glassmorphism and animations
 */
export function Modal({
    isOpen,
    onClose,
    title,
    children,
    footer,
    size = 'md', // 'sm', 'md', 'lg', 'xl'
    variant = 'default', // 'default', 'danger', 'warning', 'info', 'success'
    icon: Icon,
    closeOnBackdrop = true,
    showCloseButton = true,
    className = ''
}) {
    const sizeClasses = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
        full: 'max-w-7xl'
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
                        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
                    >
                        {/* Modal Container */}
                        <motion.div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="modal-title"
                            aria-describedby="modal-body"
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
                            onClick={(e) => e.stopPropagation()}
                            className={`
                                ${sizeClasses[size]}
                                w-full min-w-[320px]
                                bg-white/95 dark:bg-slate-900/95
                                backdrop-blur-2xl
                                rounded-3xl
                                shadow-2xl
                                border-2 border-white/20 dark:border-slate-700/50
                                overflow-hidden
                                flex flex-col
                                max-h-[85vh] md:max-h-[90vh]
                                ${className}
                            `}
                        >
                            {/* Header */}
                            <div className={`${styles.headerBg} p-5 ${styles.textColor} flex-shrink-0`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        {Icon && (
                                            <div className={`${styles.iconBg} p-2.5 rounded-xl backdrop-blur-sm`}>
                                                <Icon className="w-6 h-6" strokeWidth={2.5} />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            {typeof title === 'string' ? (
                                                <h2 id="modal-title" className="text-xl font-bold truncate">
                                                    {title}
                                                </h2>
                                            ) : (
                                                title
                                            )}
                                        </div>
                                    </div>
                                    {showCloseButton && (
                                        <button
                                            onClick={onClose}
                                            className="p-2 hover:bg-white/20 rounded-xl transition-all duration-200 flex-shrink-0 ml-3"
                                            aria-label="Close modal"
                                        >
                                            <X className="w-5 h-5" strokeWidth={2.5} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Body */}
                            <div id="modal-body" className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                {children}
                            </div>

                            {/* Footer */}
                            {footer && (
                                <div className="flex-shrink-0 px-6 py-4 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-700/40">
                                    {footer}
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
