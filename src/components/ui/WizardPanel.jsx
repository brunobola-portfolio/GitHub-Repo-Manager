import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

const panelVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 40 },
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
}

export function WizardPanel({
  isOpen,
  onClose,
  title,
  icon: Icon,
  stepInfo,
  sidebar,
  footer,
  children,
  disableEscape = false,
  isMaximized = true,
  isMobile = false,
  onToggleMaximize,
}) {
  const panelRef = useFocusTrap(isOpen, onClose, { disableEscape })

  // Mobile keyboard scroll fix
  useEffect(() => {
    if (!isOpen) return
    const handleFocus = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 300)
      }
    }
    const el = panelRef.current
    el?.addEventListener('focusin', handleFocus)
    return () => el?.removeEventListener('focusin', handleFocus)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- panelRef is a stable ref
  }, [isOpen])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const effectiveMaximized = isMobile || isMaximized

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — only in restored mode */}
          {!effectiveMaximized && (
            <motion.div
              key="wizard-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 backdrop-blur-sm"
              aria-hidden="true"
            />
          )}

          {/* Panel */}
          <motion.div
            key="wizard-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-panel-title"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ type: 'spring', duration: 0.45, bounce: 0.18 }}
            className={`
              fixed z-50 flex flex-col
              ${effectiveMaximized
                ? 'inset-0 bg-white dark:bg-slate-950'
                : 'inset-4 md:inset-8 lg:inset-y-[4vh] lg:inset-x-auto lg:w-[min(90vw,1200px)] lg:mx-auto rounded-2xl md:rounded-3xl shadow-2xl border border-white/20 dark:border-slate-700/50 bg-white/98 dark:bg-slate-950/98 backdrop-blur-2xl'
              }
              transition-[border-radius] duration-300
            `}
          >
            {/* Title Bar */}
            <div className="flex-shrink-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center h-12 md:h-14 px-4 md:px-5 gap-3">
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <div className="bg-white/15 p-1.5 md:p-2 rounded-lg backdrop-blur-sm flex-shrink-0">
                    <Icon className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2.5} />
                  </div>
                )}
                <h2 id="wizard-panel-title" className="text-sm md:text-base font-bold truncate">
                  {title}
                </h2>
              </div>

              {/* Center: Step Info */}
              {stepInfo && (
                <div className="hidden md:flex flex-1 justify-center min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={stepInfo.title}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="text-center"
                    >
                      <p className="text-sm font-semibold text-white/95 truncate">{stepInfo.title}</p>
                      {stepInfo.subtitle && (
                        <p className="text-[11px] text-white/65 truncate">{stepInfo.subtitle}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}

              {/* Right: Controls */}
              <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                {!isMobile && onToggleMaximize && (
                  <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors"
                    aria-label={isMaximized ? 'Restore wizard size' : 'Maximize wizard'}
                  >
                    <motion.div
                      animate={{ rotate: isMaximized ? 0 : 180 }}
                      transition={{ duration: 0.3 }}
                    >
                      {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </motion.div>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors"
                  aria-label="Close wizard"
                >
                  <X className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Sidebar — desktop fullscreen only */}
              {sidebar && effectiveMaximized && !isMobile && (
                <motion.aside
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: 0.1 }}
                  className="flex-shrink-0 w-60 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/60 dark:border-slate-800/50 overflow-y-auto custom-scrollbar"
                >
                  {sidebar}
                </motion.aside>
              )}

              {/* Main content area */}
              <div className="flex flex-1 flex-col min-w-0 min-h-0">
                {/* Content scrollable area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {children}
                </div>

                {/* Footer — pinned to bottom of content area */}
                {footer && (
                  <div className="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-700/40 safe-area-bottom">
                    {footer}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
