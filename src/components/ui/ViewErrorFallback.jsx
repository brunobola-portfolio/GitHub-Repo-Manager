/**
 * ViewErrorFallback — per-route / per-modal error fallback.
 *
 * Two visual variants share the same content/behaviour:
 *  - 'inline' (default): a calm card slotted into a route region. Used by
 *                        page-level boundaries (Dashboard, Repositories,
 *                        PR Review, etc.).
 *  - 'modal'           : a centred dialog with backdrop + spring entrance.
 *                        Used when the boundary wraps a Modal — the modal
 *                        itself failed to mount, so we replace it with an
 *                        equally-presentational error dialog rather than
 *                        leaking a broken card into the page below.
 *
 * Props:
 *  - viewName : Friendly label, e.g. "Settings".
 *  - error    : Error object (wired in by ErrorBoundary). Shown collapsed in
 *               <details> so power users can inspect without clutter.
 *  - onRetry  : Callback wired by ErrorBoundary to reset its error state.
 *               Falls back to a full reload.
 *  - onGoHome : Optional. When omitted we dispatch the
 *               'app:navigate-dashboard' window event and let the App shell
 *               react (or reload as a last resort).
 *  - variant  : 'inline' | 'modal'. Defaults to 'inline'.
 */
import { AlertTriangle, RotateCcw, Home, X } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

export function ViewErrorFallback({
  viewName = 'this view',
  error,
  onRetry,
  onGoHome,
  variant = 'inline',
}) {
  const reducedMotion = useReducedMotion()

  const handleGoHome = () => {
    if (onGoHome) {
      onGoHome()
      // Reset the boundary so the next render of children isn't stuck on
      // the cached error — important for modal boundaries, otherwise the
      // dialog would re-appear the next time the user re-opens the modal.
      onRetry?.()
      return
    }
    try {
      const event = new CustomEvent('app:navigate-dashboard')
      const handled = window.dispatchEvent(event)
      if (!handled) window.location.assign('/')
    } catch {
      window.location.assign('/')
    }
  }

  const handleRetry = () => {
    if (onRetry) {
      onRetry()
      return
    }
    window.location.reload()
  }

  const Card = (
    <>
      {/* Decorative gradient ring sitting behind the icon — keeps the
          dialog feeling premium without leaning on a heavy header. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 w-24 h-24 rounded-full bg-gradient-to-br from-amber-300/40 via-rose-300/30 to-indigo-400/30 blur-2xl"
        />
        <div className="relative w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 shadow-lg shadow-amber-500/25 flex items-center justify-center ring-1 ring-white/40 dark:ring-white/10">
          <AlertTriangle className="w-7 h-7 text-white" strokeWidth={2.25} aria-hidden="true" />
        </div>
      </div>

      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 text-center tracking-tight">
        Something went wrong in {viewName}
      </h2>
      <p className="mt-1.5 text-slate-500 dark:text-slate-400 text-sm text-center leading-relaxed">
        Try reloading this view or return home.
      </p>

      <div className="mt-6 flex gap-3 justify-center">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus:outline-none shadow-sm shadow-indigo-500/20"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
        <button
          type="button"
          onClick={handleGoHome}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-100 rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus:outline-none"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          Go to Dashboard
        </button>
      </div>

      {error?.message && (
        <details className="mt-5 text-left group">
          <summary className="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 transition-colors select-none list-none flex items-center gap-1.5 justify-center">
            <span className="inline-block w-1 h-1 rounded-full bg-current" />
            Technical details
          </summary>
          <pre className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 ring-1 ring-slate-200/60 dark:ring-slate-800 text-[11px] text-slate-600 dark:text-slate-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        </details>
      )}
    </>
  )

  if (variant === 'modal') {
    return (
      <AnimatePresence>
        <motion.div
          key="error-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleGoHome()
          }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-md"
        >
          <motion.div
            role="alertdialog"
            aria-live="assertive"
            aria-labelledby="view-error-title"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 16 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 16 }}
            transition={reducedMotion ? { duration: 0.15 } : { type: 'spring', duration: 0.4, bounce: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-[0_25px_60px_-12px_rgba(0,0,0,0.45)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.75)] ring-1 ring-slate-200/60 dark:ring-slate-700/60 p-7 overflow-hidden"
          >
            <button
              type="button"
              onClick={handleGoHome}
              aria-label="Close"
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus:outline-none"
            >
              <X className="w-4 h-4" />
            </button>
            <div id="view-error-title" className="sr-only">
              Something went wrong in {viewName}
            </div>
            {Card}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    )
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[320px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-6"
    >
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl dark:shadow-black/30 ring-1 ring-slate-200/60 dark:ring-slate-700/60 p-8">
        {Card}
      </div>
    </div>
  )
}

export default ViewErrorFallback
