import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useMobileKeyboardFix } from '../../hooks/useMobileKeyboardFix'

const PANEL_SIZES = {
  sm: 'w-[min(92vw,520px)]',
  md: 'w-[min(92vw,680px)]',
  lg: 'w-[min(92vw,900px)]',
  xl: 'w-[min(92vw,1140px)]',
}

// headerGradient prop kept for backward-compat; default header is now solid indigo
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

  headerGradient: _headerGradient = '',
  size = 'xl',
}) {
  const panelRef = useFocusTrap(isOpen, onClose, { disableEscape })
  useMobileKeyboardFix(isOpen, panelRef)
  useBodyScrollLock(isOpen)

  const effectiveMaximized = isMobile || isMaximized

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="wizard-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: effectiveMaximized ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[var(--ds-z-modal)] bg-black/60 dark:bg-black/75 backdrop-blur-md"
            style={{ pointerEvents: effectiveMaximized ? 'none' : 'auto' }}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="wizard-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-panel-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.12 }}
            className={`
              fixed z-[var(--ds-z-modal)] flex flex-col overflow-hidden
              ${effectiveMaximized
                ? 'inset-0 bg-white dark:bg-slate-950'
                : `inset-x-0 mx-auto top-[clamp(1.5rem,5vh,4rem)] max-h-[min(90vh,calc(100vh-3rem))] ${PANEL_SIZES[size] || PANEL_SIZES.xl} rounded-2xl bg-white dark:bg-slate-950 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] ring-1 ring-slate-200/50 dark:ring-slate-700/50`
              }
            `}
          >
            {/* Title Bar */}
            <div className={`
              flex-shrink-0 text-white flex items-center h-12 md:h-[52px] px-4 md:px-5 gap-3
              bg-indigo-600 dark:bg-indigo-700
              ${effectiveMaximized ? '' : 'border-b border-white/10'}
            `}>
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <div className="bg-white/15 p-1.5 rounded-lg flex-shrink-0 transition-all">
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                  </div>
                )}
                <h2 id="wizard-panel-title" className="text-sm font-semibold tracking-tight truncate">
                  {title}
                </h2>
              </div>

              {/* Center: Step Info */}
              {stepInfo && (
                <div className="hidden md:flex flex-1 justify-center min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={stepInfo.title}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="text-center"
                    >
                      <p className="text-[13px] font-medium text-white/90 truncate">{stepInfo.title}</p>
                      {stepInfo.subtitle && (
                        <p className="text-[11px] text-white/55 truncate">{stepInfo.subtitle}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}

              {/* Right: Controls */}
              <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                {!isMobile && onToggleMaximize && (
                  <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="p-2 hover:bg-white/15 rounded-lg transition-colors"
                    aria-label={isMaximized ? 'Restore wizard size' : 'Maximize wizard'}
                  >
                    {isMaximized
                      ? <Minimize2 className="w-3.5 h-3.5" strokeWidth={2} />
                      : <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
                    }
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-white/15 rounded-lg transition-colors ds-focus-ring"
                  aria-label="Close wizard"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="flex flex-1 min-h-0 overflow-hidden bg-slate-50/50 dark:bg-slate-950">
              {/* Sidebar — desktop fullscreen only */}
              {sidebar && effectiveMaximized && !isMobile && (
                <motion.aside
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.08 }}
                  className="flex-shrink-0 w-60 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-hidden relative"
                >
                  {/* Sidebar atmospheric glow */}
                  <div className="absolute -bottom-20 -left-10 w-40 h-40 bg-indigo-400/[0.06] dark:bg-indigo-400/[0.08] rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-violet-400/[0.04] dark:bg-violet-400/[0.06] rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
                  <div className="relative h-full overflow-y-auto ds-scrollbar">
                    {sidebar}
                  </div>
                </motion.aside>
              )}

              {/* Main content area */}
              <div className="flex flex-1 flex-col min-w-0 min-h-0 relative">
                {/* Atmospheric background */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                  <div className="absolute -top-32 -right-32 w-[420px] h-[420px] bg-indigo-400/[0.04] dark:bg-indigo-400/[0.05] rounded-full blur-3xl" />
                  <div className="absolute -bottom-24 -left-24 w-[340px] h-[340px] bg-purple-400/[0.03] dark:bg-purple-400/[0.04] rounded-full blur-3xl" />
                </div>

                {/* Content scrollable area */}
                <div className="flex-1 overflow-y-auto ds-scrollbar relative">
                  {children}
                </div>

                {/* Footer — height + horizontal padding intentionally match the
                    shared Modal primitive (min-h-[64px] md:min-h-[68px], px-4
                    md:px-5) so every popup family has the same footer rhythm. */}
                {footer && (
                  <div className="flex-shrink-0 relative flex items-center min-h-[64px] md:min-h-[68px] px-4 md:px-5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[var(--ds-shadow-overlay)] safe-area-bottom">
                    <div className="w-full">
                      {footer}
                    </div>
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
