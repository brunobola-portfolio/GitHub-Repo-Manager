import { Suspense } from 'react'
import ErrorBoundary from '../ErrorBoundary'
import { ViewErrorFallback } from './ViewErrorFallback'
import { RouteFallback } from './RouteFallback'

/**
 * ViewShell — the shared boundary for a routed view in App's <main> switch.
 *
 * Every code-split view renders the same three layers around its content: a
 * fade-in container, a per-view ErrorBoundary that degrades to ViewErrorFallback
 * (named, with an optional onGoHome), and a Suspense boundary for the lazy chunk.
 * Wrapping that once here keeps the App switch to one line of intent per view
 * instead of nine identical six-line wrappers.
 *
 * @param {string}   name      Friendly view label for the error fallback.
 * @param {Function} [onGoHome] Optional "return home" handler; when omitted the
 *                              fallback dispatches the app:navigate-dashboard event.
 * @param {string}   [fadeClass] Entrance animation classes (default duration-500).
 */
export function ViewShell({ name, onGoHome, fadeClass = 'animate-in fade-in duration-500', children }) {
  return (
    <div className={fadeClass}>
      <ErrorBoundary fallback={<ViewErrorFallback viewName={name} onGoHome={onGoHome} />}>
        <Suspense fallback={<RouteFallback />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
