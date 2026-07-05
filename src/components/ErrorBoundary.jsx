import { Component, cloneElement, isValidElement } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { getCsrfToken } from '../utils/api'
import { Button } from './ui/Button'

// A failed dynamic import is almost always a stale session after a redeploy:
// the loaded index.html references old content-hashed chunk URLs that no
// longer exist on the server. A full reload fetches the fresh HTML and fixes
// it — so try that ONCE automatically before showing the error card (the
// sessionStorage guard prevents a reload loop when the server is truly down).
const CHUNK_LOAD_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk .+ failed|importing a module script failed/i
const CHUNK_RELOAD_FLAG = 'chunk-reload-attempted'

function tryChunkReloadRecovery(error) {
  if (!CHUNK_LOAD_ERROR_RE.test(error?.message ?? '')) return false
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return false
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()))
  } catch {
    return false // storage unavailable — fall through to the error card
  }
  window.location.reload()
  return true
}

// If the app has been alive for a while after a recovery reload, the redeploy
// was picked up successfully — re-arm the guard so a FUTURE redeploy can also
// self-heal (without this, only the first redeploy per tab would recover).
if (typeof window !== 'undefined') {
  setTimeout(() => {
    try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG) } catch { /* ignore */ }
  }, 30_000)
}

class ErrorBoundary extends Component {
  state = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    if (tryChunkReloadRecovery(error)) return
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught:', error, errorInfo)

    // Report error to backend for monitoring (best-effort, fire and forget)
    ;(async () => {
      const headers = { 'Content-Type': 'application/json' }
      try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* drop telemetry rather than block */ }
      try {
        await fetch('/api/system/client-error', {
          method: 'POST',
          credentials: 'include',
          headers,
          // Schema is .strict() server-side — only send fields it accepts.
          body: JSON.stringify({
            message: (error?.message ?? 'Unknown error').slice(0, 1000),
            // eslint-disable-next-line no-restricted-syntax -- legitimate telemetry POST, not UI surface
            stack: error?.stack?.slice(0, 5000),
            componentStack: errorInfo?.componentStack?.slice(0, 5000),
            url: window.location.href.slice(0, 2000),
            userAgent: navigator.userAgent?.slice(0, 500)
          })
        })
      } catch {
        // Silently ignore reporting failures
      }
    })()
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      // Caller-supplied fallback takes precedence. It can be either a plain
      // ReactElement (e.g. <ViewErrorFallback viewName="Foo" />) or a render
      // function ({ error, retry }) => ReactNode. When a ReactElement is
      // passed and it doesn't already have an onRetry prop, we wire our
      // handleRetry in so the user can recover without reloading.
      if (this.props.fallback) {
        const { fallback } = this.props
        if (typeof fallback === 'function') {
          return fallback({ error: this.state.error, retry: this.handleRetry })
        }
        if (isValidElement(fallback) && fallback.props.onRetry === undefined) {
          return cloneElement(fallback, {
            error: fallback.props.error ?? this.state.error,
            onRetry: this.handleRetry,
          })
        }
        return fallback
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 bg-red-50 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Something went wrong
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
              An unexpected error occurred. You can try again or reload the page.
            </p>
            {this.state.error?.message && (
              <details className="text-left mb-6 -mt-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded ds-focus-ring">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-100 dark:bg-slate-900/60 p-3 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <Button
                variant="primary"
                size="md"
                onClick={this.handleRetry}
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
