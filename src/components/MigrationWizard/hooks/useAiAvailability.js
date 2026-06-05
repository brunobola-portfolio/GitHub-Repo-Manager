import { useState, useEffect } from 'react'
import { isAIUnavailable, subscribeAIUnavailable } from '../../../utils/aiAvailability'

// Maps a markAIUnavailable("<status>:<endpoint>") reason into a single short
// user-facing line — specific enough to help debugging (Settings → AI) without
// dumping HTTP status codes on the user.
function humanizeAIReason(reason = '') {
  if (reason.startsWith('404:')) return 'AI unavailable: the configured model was not found. Check GEMINI_MODEL in Settings.'
  if (reason.startsWith('422:')) return 'AI unavailable: invalid or expired key. Update it in Settings → AI.'
  if (reason.startsWith('400:')) return 'AI unavailable: no AI key configured. Set one up in Settings.'
  return 'AI unavailable for this session — suggestions use the template.'
}

/**
 * Tracks whether AI description generation is available for RepoConfigStep:
 * probes /api/config/ai-status on mount, then downgrades + surfaces a single
 * dismissible notice if a fatal AI failure happens during the step
 * (subscribeAIUnavailable). `setAiNotice` is exposed so the component can
 * dismiss the notice. Extracted from RepoConfigStep; behaviour unchanged.
 *
 * @returns {{ aiAvailable: boolean, aiNotice: string, setAiNotice: Function }}
 */
export function useAiAvailability() {
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiNotice, setAiNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/config/ai-status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d) => {
        if (cancelled) return
        // Honor any session-scoped unavailability (set by a previous wizard step
        // that already hit a fatal AI 4xx). Avoids re-enabling AI just because the
        // config probe says the key exists — it may point at a missing model.
        setAiAvailable(!!d?.configured && !isAIUnavailable())
      })
      .catch(() => { if (!cancelled) setAiAvailable(false) })
    return () => { cancelled = true }
  }, [])

  // React to a fatal AI failure DURING the step (e.g. Generate returns 404):
  // downgrade the button to template-only + show a single dismissible notice.
  useEffect(() => {
    if (isAIUnavailable()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAiAvailable(false)
    }
    const unsub = subscribeAIUnavailable((reason) => {
      setAiAvailable(false)
      setAiNotice(humanizeAIReason(reason))
    })
    return unsub
  }, [])

  return { aiAvailable, aiNotice, setAiNotice }
}
