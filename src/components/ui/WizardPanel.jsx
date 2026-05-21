import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
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

// Per non-LLM theme: neutral header with soft-tinted icon tile communicates
// the variant tone. Mirrors Modal.jsx — keep both in sync.
const VARIANT_ICON_STYLES = {
  default: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  danger:  'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  info:    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
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
  variant = 'default',
}) {
  const panelRef = useFocusTrap(isOpen, onClose, { disableEscape })
  useMobileKeyboardFix(isOpen, panelRef)
  useBodyScrollLock(isOpen)
  const reduced = useReducedMotion()

  const effectiveMaximized = isMobile || isMaximized
  const iconTileClass = VARIANT_ICON_STYLES[variant] || VARIANT_ICON_STYLES.default

  // Match Modal.jsx's spring timing exactly so the two shells animate in
  // sync when a flow opens a wizard from inside a modal (or vice-versa).
  // Reduced-motion users get a short fade so the entrance is calm but the
  // dialog still telegraphs the state change.
  const panelTransition = reduced
    ? { duration: 0.15 }
    : { type: 'spring', duration: 0.4, bounce: 0.12 }
  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.18 }

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
            transition={backdropTransition}
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
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            transition={panelTransition}
            className={`
              fixed z-[var(--ds-z-modal)] flex flex-col overflow-hidden
              ${effectiveMaximized
                ? 'inset-0 bg-white dark:bg-[color:var(--ds-surface-dark)]'
                : `inset-x-0 mx-auto top-[clamp(1.5rem,5vh,4rem)] max-h-[min(90vh,calc(100vh-3rem))] ${PANEL_SIZES[size] || PANEL_SIZES.xl} rounded-2xl bg-white dark:bg-[color:var(--ds-surface-dark)] shadow-[var(--ds-shadow-lg)] ring-1 ring-slate-200/50 dark:ring-[color:var(--ds-border-dark)]`
              }
            `}
          >
            {/* Title Bar — neutral GitHub-utilitarian header; variant tone lives in the icon tile only. */}
            <div className="flex-shrink-0 text-slate-900 dark:text-slate-100 flex items-center h-12 md:h-[52px] px-4 md:px-5 gap-3 border-b border-slate-200 dark:border-[color:var(--ds-border-dark)]">
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <div className={`${iconTileClass} p-1.5 rounded-lg flex-shrink-0 transition-all`}>
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
                      <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">{stepInfo.title}</p>
                      {stepInfo.subtitle && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{stepInfo.subtitle}</p>
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
                    className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
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
                  className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors ds-focus-ring"
                  aria-label="Close wizard"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="flex flex-1 min-h-0 overflow-hidden bg-slate-50/50 dark:bg-[color:var(--ds-surface-dark)]">
              {/* Sidebar — desktop fullscreen only */}
              {sidebar && effectiveMaximized && !isMobile && (
                <motion.aside
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.08 }}
                  className="flex-shrink-0 w-60 bg-white dark:bg-[color:var(--ds-surface-subtle-dark)] border-r border-slate-200 dark:border-[color:var(--ds-border-dark)] overflow-hidden"
                >
                  <div className="h-full overflow-y-auto ds-scrollbar">
                    {sidebar}
                  </div>
                </motion.aside>
              )}

              {/* Main content area */}
              <div className="flex flex-1 flex-col min-w-0 min-h-0">
                {/* Content scrollable area */}
                <div className="flex-1 overflow-y-auto ds-scrollbar">
                  {children}
                </div>

                {/* Footer — height + horizontal padding intentionally match the
                    shared Modal primitive (min-h-[64px] md:min-h-[68px], px-4
                    md:px-5) so every popup family has the same footer rhythm. */}
                {footer && (
                  <div className="flex-shrink-0 flex items-center min-h-[64px] md:min-h-[68px] px-4 md:px-5 bg-white dark:bg-[color:var(--ds-surface-dark)] border-t border-slate-200 dark:border-[color:var(--ds-border-dark)] shadow-[var(--ds-shadow-overlay)] safe-area-bottom">
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
