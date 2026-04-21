/**
 * ViewErrorFallback — per-route / per-modal error fallback.
 *
 * Rendered by ErrorBoundary when a lazy view throws during render. The goal
 * is to keep the app shell (header, sidebar, nav) intact while only the
 * failed view is replaced by this contextual message.
 *
 * Intentionally lightweight: only uses lucide icons (already in the shared
 * chunk) and Tailwind classes — no motion / heavy deps. Adds ~1 KB gzipped.
 *
 * Props:
 *  - viewName     : Friendly label, e.g. "Repository Detail".
 *  - error        : Error object, wired in by ErrorBoundary. Shown in a
 *                   collapsed <details> so power users can inspect without
 *                   cluttering the default UI.
 *  - onRetry      : Callback wired by ErrorBoundary to reset its error state.
 *                   Falls back to a key bump via forceUpdate-style reload.
 *  - onGoHome     : Optional. When omitted we dispatch a window CustomEvent
 *                   ('app:navigate-dashboard') so the App shell can react
 *                   without us importing it directly (keeps coupling low).
 */
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'

export function ViewErrorFallback({ viewName = 'this view', error, onRetry, onGoHome }) {
  const handleGoHome = () => {
    if (onGoHome) {
      onGoHome()
      return
    }
    // Shell-agnostic fallback: emit a DOM event the App can listen to.
    // If no listener wires it, reload the page as a last resort so the user
    // isn't stuck on the fallback.
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
    // If no retry wired, force a full reload as a last resort.
    window.location.reload()
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[320px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-6"
    >
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl dark:shadow-black/30 p-8 text-center">
        <div className="w-12 h-12 bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-500 dark:text-amber-400" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          Something went wrong in {viewName}
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-5 leading-relaxed">
          Try reloading this view or return home.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus:outline-none"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            onClick={handleGoHome}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus:outline-none"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            Go to Dashboard
          </button>
        </div>
        {error?.message && (
          <details className="mt-5 text-left">
            <summary className="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 transition-colors select-none">
              Technical details
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-[11px] text-slate-600 dark:text-slate-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export default ViewErrorFallback
