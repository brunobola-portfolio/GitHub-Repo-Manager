/*
 * GitHub Repo Manager
 * React entry point and theme wiring
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { init as sentryInit, captureException as sentryCaptureException } from '@sentry/react'
import './index.css'
import './design-system.css'
import App from './App.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './contexts/ToastProvider.jsx'
import { shouldIgnoreClientError } from './utils/errorClassification.js'

// The public status page mounts at /status without any auth/app context.
// Lazy-loaded so the tiny chunk is only fetched when needed and doesn't
// bloat the main bundle.
// eslint-disable-next-line react-refresh/only-export-components
const StatusPage = lazy(() => import('./components/PublicStatus/StatusPage.jsx'))

if (import.meta.env.VITE_SENTRY_DSN) {
  sentryInit({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  })
}

// Last-resort capture for unhandled promise rejections AND synchronous errors
// that escape every boundary. Without this, `.catch(() => {})` and bare
// `throw`s in event handlers hide in dev-tools. Sentry (if configured)
// captures automatically; we also log + surface a friendly toast so the user
// sees that something went wrong instead of staring at a frozen UI.
//
// Browser-extension noise (uBlock, password managers, etc.) is filtered up
// front via shouldIgnoreClientError so it never reaches Sentry/the UI.
if (typeof window !== 'undefined') {
  const broadcast = (error, source) => {
    try {
      window.dispatchEvent(new CustomEvent('app:unhandled-error', {
        detail: { error, source },
      }))
    } catch {
      // CustomEvent unavailable in ancient browsers — falling back silently is
      // fine; we've already logged + reported to Sentry above this call.
    }
  }

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    if (shouldIgnoreClientError(reason)) return
    console.error('[unhandledrejection]', reason)
    if (import.meta.env.VITE_SENTRY_DSN && reason instanceof Error) {
      sentryCaptureException(reason)
    }
    broadcast(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledrejection')
  })

  // Synchronous errors that don't reach an ErrorBoundary land here — typically
  // event-handler throws and resource-load failures. ErrorEvent.filename gives
  // us the script source, which is what the extension filter keys on.
  window.addEventListener('error', (event) => {
    const error = event.error || event.message
    if (shouldIgnoreClientError(error, event.filename)) return
    console.error('[window.error]', error)
    if (import.meta.env.VITE_SENTRY_DSN && error instanceof Error) {
      sentryCaptureException(error)
    }
    broadcast(error instanceof Error ? error : new Error(String(event.message || error)), 'error')
  })
}

const isStatusRoute = typeof window !== 'undefined' && window.location.pathname === '/status'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ToastProvider>
          <ErrorBoundary>
            {isStatusRoute ? (
              <Suspense fallback={null}>
                <StatusPage />
              </Suspense>
            ) : (
              <App />
            )}
          </ErrorBoundary>
        </ToastProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
)
