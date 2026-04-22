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
import * as Sentry from '@sentry/react'
import './index.css'
import './design-system.css'
import App from './App.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './contexts/ToastProvider.jsx'

// The public status page mounts at /status without any auth/app context.
// Lazy-loaded so the tiny chunk is only fetched when needed and doesn't
// bloat the main bundle.
// eslint-disable-next-line react-refresh/only-export-components
const StatusPage = lazy(() => import('./components/PublicStatus/StatusPage.jsx'))

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  })
}

// Last-resort capture for promise rejections that aren't awaited or caught.
// Without this, `.catch(() => {})` swallows errors silently and bugs like
// rate-limit storms or stale tokens hide in dev-tools. Sentry (if configured)
// captures automatically; we also log so self-hosted users see the trace.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    // Ignore aborted fetches — React StrictMode and route changes cancel them
    // routinely and they aren't actionable.
    if (message.includes('AbortError') || reason?.name === 'AbortError') return
    console.error('[unhandledrejection]', reason)
    if (import.meta.env.VITE_SENTRY_DSN && reason instanceof Error) {
      Sentry.captureException(reason)
    }
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
