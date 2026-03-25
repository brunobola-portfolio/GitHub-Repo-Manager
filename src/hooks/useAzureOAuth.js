// src/hooks/useAzureOAuth.js
import { useState, useRef, useCallback } from 'react'

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 120_000

/**
 * Manages Azure AD OAuth flow from the client side.
 * The token never leaves the server — this hook only polls for readiness.
 *
 * Instantiate in MigrationWizard.jsx and pass as `oauthHook` prop to SourceStep.
 *
 * oauthStatus: 'idle' | 'pending' | 'success' | 'error' | 'timeout'
 *
 * IMPORTANT: startOAuth() does NOT open the browser tab.
 * The caller (SourceStep button handler) opens the tab via window.open('/api/azure/oauth/start', '_blank')
 * and then calls startOAuth() to begin state tracking and polling.
 */
export function useAzureOAuth() {
  const [oauthStatus, setOauthStatus] = useState('idle')
  const intervalRef = useRef(null)
  const timeoutRef = useRef(null)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/azure/oauth/token', { credentials: 'include' })
        const data = await res.json()
        if (data.error) {
          stopPolling()
          setOauthStatus('error')
        } else if (data.ready) {
          stopPolling()
          setOauthStatus('success')
        }
      } catch {
        stopPolling()
        setOauthStatus('error')
      }
    }, POLL_INTERVAL_MS)

    timeoutRef.current = setTimeout(() => {
      stopPolling()
      setOauthStatus((prev) => prev === 'pending' ? 'timeout' : prev)
    }, POLL_TIMEOUT_MS)
  }, [stopPolling])

  // startOAuth: sets status to 'pending' and starts polling.
  // The CALLER is responsible for opening the OAuth browser tab via window.open().
  const startOAuth = useCallback(() => {
    setOauthStatus('pending')
    startPolling()
  }, [startPolling])

  const retryOAuth = useCallback(() => {
    stopPolling()
    setOauthStatus('idle')
  }, [stopPolling])

  const pausePolling = useCallback(() => {
    // Clear only the interval — timeout continues so the overall 120s cap is respected
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const resumePolling = useCallback(() => {
    // Only resume if currently pending (not success/error/timeout)
    setOauthStatus((prev) => {
      if (prev === 'pending' && !intervalRef.current) {
        intervalRef.current = setInterval(async () => {
          try {
            const res = await fetch('/api/azure/oauth/token', { credentials: 'include' })
            const data = await res.json()
            if (data.error) {
              stopPolling()
              setOauthStatus('error')
            } else if (data.ready) {
              stopPolling()
              setOauthStatus('success')
            }
          } catch {
            stopPolling()
            setOauthStatus('error')
          }
        }, POLL_INTERVAL_MS)
      }
      return prev
    })
  }, [stopPolling])

  return { oauthStatus, startOAuth, retryOAuth, pausePolling, resumePolling }
}
