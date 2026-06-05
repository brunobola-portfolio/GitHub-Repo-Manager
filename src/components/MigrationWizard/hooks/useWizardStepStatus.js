/**
 * useWizardStepStatus — derives the sidebar's per-step status overrides and
 * the inline status hint from live wizard state. Pure derivation from
 * currentStep + importJobs; holds no state of its own.
 *
 * @returns {{ stepStates: object, currentStepStatusDetail: string|undefined }}
 *   stepStates — { [stepId]: 'error'|'loading'|'done' } overrides consumed by
 *     SidebarStepper to mirror import-job progress on the progress/summary steps.
 *   currentStepStatusDetail — short string shown under the current step name
 *     (e.g. "2 jobs running"); undefined when there's nothing to surface.
 */
export function useWizardStepStatus({ currentStep, importJobs }) {
  // Derive per-step status from live wizard state so the sidebar mirrors
  // what's happening in the main panel (loading spinner on a step running
  // async work, red disc on a step with blocking errors, etc.).
  const stepStates = (() => {
    const out = {}
    // Progress step: reflect import-job aggregate state. A failed job →
    // 'error', any still running → 'loading', all done → 'done'.
    const jobs = Array.isArray(importJobs) ? importJobs : []
    if (jobs.length > 0) {
      const anyFailed = jobs.some((j) => j?.status === 'failed' || j?.status === 'error')
      const anyRunning = jobs.some((j) => j?.status === 'running' || j?.status === 'pending' || j?.status === 'queued')
      const allDone = jobs.every((j) => j?.status === 'complete' || j?.status === 'completed')
      if (anyFailed) out.progress = 'error'
      else if (anyRunning) out.progress = 'loading'
      else if (allDone) out.progress = 'done'
    }
    // Summary step: 'done' once all jobs completed successfully.
    if (jobs.length > 0 && jobs.every((j) => j?.status === 'complete' || j?.status === 'completed')) {
      out.summary = 'done'
    }
    return out
  })()

  // Inline status hint under the current step name. Keeps the user aware
  // of background activity without forcing them to look at the main panel.
  const currentStepStatusDetail = (() => {
    if (currentStep === 'progress' && Array.isArray(importJobs) && importJobs.length > 0) {
      const running = importJobs.filter((j) => j?.status === 'running' || j?.status === 'pending').length
      const failed = importJobs.filter((j) => j?.status === 'failed' || j?.status === 'error').length
      if (failed > 0) return `${failed} ${failed === 1 ? 'failed' : 'failed'} · ${running} running`
      if (running > 0) return `${running} ${running === 1 ? 'job running' : 'jobs running'}`
    }
    return undefined
  })()

  return { stepStates, currentStepStatusDetail }
}
