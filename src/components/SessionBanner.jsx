import { motion, AnimatePresence } from 'framer-motion'
import { EASE } from './ui/motion'
import { ShieldAlert, LogIn, X } from 'lucide-react'
import { Tooltip } from './ui/Tooltip'

export function SessionBanner({ visible, onLogin, onDismiss }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: EASE.emphasized }}
          className="relative z-[var(--ds-z-floating)]"
        >
          <div className="ds-session-banner">
            <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-2.5 flex items-center justify-between gap-3 sm:gap-4">
              {/* Left: icon + message */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-500/15 dark:bg-amber-400/10 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" strokeWidth={2} />
                </div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90 truncate">
                  <span className="hidden sm:inline">Your session has expired. </span>
                  <span className="sm:hidden">Session expired. </span>
                  <span className="text-amber-600 dark:text-amber-300/70">Please sign in again to continue.</span>
                </p>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onLogin}
                  className="group flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold
                    bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400
                    text-white dark:text-slate-900
                    shadow-sm hover:shadow-lg
                    transition-colors duration-200
                    focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus:outline-none"
                >
                  <LogIn className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                  Sign In
                </button>
                {onDismiss && (
                  <Tooltip label="Dismiss">
                    <button
                      type="button"
                      onClick={onDismiss}
                      className="p-1.5 rounded-md text-amber-500/60 dark:text-amber-400/40
                        hover:text-amber-700 dark:hover:text-amber-300
                        hover:bg-amber-500/10 dark:hover:bg-amber-400/10
                        transition-colors duration-200 ds-focus-ring"
                      aria-label="Dismiss notification"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
