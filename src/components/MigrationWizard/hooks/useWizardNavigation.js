import { useState, useCallback, useEffect, useRef } from 'react'
import { getCsrfToken } from '../../../utils/api'

/**
 * useWizardNavigation — owns the wizard shell's directional transitions and
 * the URL/GitHub import kickoff, layered on top of the step machine
 * (nextStep/prevStep) from useMigrationWizard. Encapsulates:
 *   - the slide `direction` state (exposed so callers like the breadcrumb and
 *     the Azure progress step can also set the animation direction),
 *   - Next/Back handlers that set direction before advancing,
 *   - the auto-advance off the sourceType step once a source is chosen,
 *   - handleStartImport — the POST body assembly + outcome handling for the
 *     URL and GitHub import flows.
 */
export function useWizardNavigation({
  source,
  currentStepIndex,
  steps,
  nextStep,
  prevStep,
  updateImportJobs,
  toast,
}) {
  const [direction, setDirection] = useState(1)

  const handleNext = useCallback(() => { setDirection(1); nextStep() }, [nextStep])
  const handleBack = useCallback(() => { setDirection(-1); prevStep() }, [prevStep])

  // Auto-advance when sourceType is set on the sourceType step
  const prevSourceType = useRef(source.sourceType)
  useEffect(() => {
    if (source.sourceType && !prevSourceType.current && currentStepIndex === 0) {
      Promise.resolve().then(() => {
        setDirection(1)
        nextStep()
      })
    }
    prevSourceType.current = source.sourceType
  }, [source.sourceType, currentStepIndex, steps.length, nextStep])

  // Start import for URL/GitHub flows
  const handleStartImport = useCallback(async () => {
    updateImportJobs({ importing: true })
    setDirection(1)

    try {
      const endpoint = '/api/import/url'
      let body

      if (source.sourceType === 'github') {
        body = {
          sourceUrl: source.githubSourceUrl,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.githubSourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      } else {
        let credentials
        if (source.authType === 'token') credentials = { type: 'token', token: source.authToken }
        else if (source.authType === 'basic') credentials = { type: 'basic', username: source.authUsername, password: source.authPassword }

        body = {
          sourceUrl: source.sourceUrl,
          credentials,
          targetOrg: source.targetOrg || undefined,
          targetName: source.targetName || source.sourceUrl.replace(/\.git$/, '').split('/').pop(),
          makePrivate: source.makePrivate,
          description: source.description,
        }
      }

      const headers = { 'Content-Type': 'application/json' }
      try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.success) {
        updateImportJobs({ jobId: data.jobId })
        toast.success('Import queued')
        nextStep()
      } else {
        updateImportJobs({
          importing: false,
          jobStatus: { status: 'failed', errorMessage: data.error, progressPct: 0 },
        })
        toast.error(`Failed to start import — ${data.error || 'try again'}`)
        nextStep()
      }
    } catch (e) {
      updateImportJobs({
        importing: false,
        jobStatus: { status: 'failed', errorMessage: e.message, progressPct: 0 },
      })
      toast.errorFromException(e, { fallbackTitle: 'Failed to start import' })
      nextStep()
    }
  }, [source, updateImportJobs, nextStep, toast])

  return { direction, setDirection, handleNext, handleBack, handleStartImport }
}
