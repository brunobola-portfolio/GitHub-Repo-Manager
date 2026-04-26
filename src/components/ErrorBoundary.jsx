import { Component, cloneElement, isValidElement } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

class ErrorBoundary extends Component {
  state = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught:', error, errorInfo)

    // Report error to backend for monitoring
    try {
      fetch('/api/system/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message,
          // eslint-disable-next-line no-restricted-syntax -- legitimate telemetry POST, not UI surface
          stack: error?.stack?.slice(0, 5000),
          componentStack: errorInfo?.componentStack?.slice(0, 5000),
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      }).catch(() => {}) // Don't let reporting failure cause another error
    } catch {
      // Silently ignore reporting failures
    }
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
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl dark:shadow-black/30 p-8 text-center">
            <div className="w-14 h-14 bg-red-50 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Something went wrong
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
              {this.state.error?.message || 'An unexpected error occurred. You can try again or reload the page.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus:outline-none"
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus:outline-none"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
