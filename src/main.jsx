/*
 * GitHub Repo Manager
 * React entry point and theme wiring
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import './design-system.css'
import App from './App.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './contexts/ToastProvider.jsx'
import { shouldIgnoreClientError } from './utils/errorClassification.js'
import { emitAppEvent, APP_EVENTS } from './utils/appEvents'
import { setSentry, getSentry } from './lib/sentry-client'

// The public status page mounts at /status without any auth/app context.
// Lazy-loaded so the tiny chunk is only fetched when needed and doesn't
// bloat the main bundle.
// eslint-disable-next-line react-refresh/only-export-components
const StatusPage = lazy(() => import('./components/PublicStatus/StatusPage.jsx'))
// Same deal for the privacy policy: a visitor must be able to read it BEFORE
// deciding to hand over GitHub access, which means it cannot live behind the
// authenticated shell.
// eslint-disable-next-line react-refresh/only-export-components
const PrivacyPage = lazy(() => import('./components/PublicLegal/PrivacyPage.jsx'))
// Same reasoning for the terms: what you are agreeing to, and the 14-day
// withdrawal right, have to be readable before anyone pays — which means
// before anyone signs in.
// eslint-disable-next-line react-refresh/only-export-components
const TermsPage = lazy(() => import('./components/PublicLegal/TermsPage.jsx'))

// Browser telemetry is runtime configuration: the server puts the
// deployment's public DSN in a meta tag (SENTRY_BROWSER_DSN) and relays the
// events through its own origin, so the CSP stays connect-src 'self' and an
// install without the variable ships no telemetry at all. A build-time
// VITE_SENTRY_DSN still works for local development, sent directly.
const runtimeSentryDsn = typeof document !== 'undefined'
  ? document.querySelector('meta[name="grm-sentry-dsn"]')?.getAttribute('content')
  : null
const sentryDsn = runtimeSentryDsn || import.meta.env.VITE_SENTRY_DSN
const SENTRY_FILTERED_QUERY = /([?&](?:code|state|token|access_token|key)=)[^&#]*/gi
// The SDK is loaded only when a DSN exists: statically imported it would sit
// in the entry chunk of every install, telemetry or not (≈22 KB gzipped).
if (sentryDsn) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
    dsn: sentryDsn,
    tunnel: runtimeSentryDsn ? '/api/monitoring/tunnel' : undefined,
    environment: import.meta.env.MODE,
    release: `github-repo-manager@${import.meta.env.VITE_APP_VERSION}`,
    sendDefaultPii: false,
    // OAuth callbacks carry ?code=&state= in the URL for a moment; nothing
    // with a credential in it leaves the browser.
    beforeSend(event) {
      if (event.request?.url) event.request.url = event.request.url.replace(SENTRY_FILTERED_QUERY, '$1[Filtered]')
      delete event.request?.cookies
      return event
    },
    })
    setSentry(Sentry)
  }).catch(() => { /* telemetry must never break the app */ })
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
    emitAppEvent(APP_EVENTS.UNHANDLED_ERROR, { error, source })
  }

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    if (shouldIgnoreClientError(reason)) return
    console.error('[unhandledrejection]', reason)
    if (reason instanceof Error) getSentry()?.captureException(reason)
    broadcast(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledrejection')
  })

  // Synchronous errors that don't reach an ErrorBoundary land here — typically
  // event-handler throws and resource-load failures. ErrorEvent.filename gives
  // us the script source, which is what the extension filter keys on.
  window.addEventListener('error', (event) => {
    const error = event.error || event.message
    if (shouldIgnoreClientError(error, event.filename)) return
    console.error('[window.error]', error)
    if (error instanceof Error) getSentry()?.captureException(error)
    broadcast(error instanceof Error ? error : new Error(String(event.message || error)), 'error')
  })
}

const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') || '/' : '/'
const isStatusRoute = path === '/status'
const isPrivacyRoute = path === '/privacy'
const isTermsRoute = path === '/terms'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ToastProvider>
          <ErrorBoundary>
            {isTermsRoute ? (
              <Suspense fallback={null}>
                <TermsPage />
              </Suspense>
            ) : isPrivacyRoute ? (
              <Suspense fallback={null}>
                <PrivacyPage />
              </Suspense>
            ) : isStatusRoute ? (
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
