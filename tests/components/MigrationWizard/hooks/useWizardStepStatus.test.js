import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWizardStepStatus } from '@/components/MigrationWizard/hooks/useWizardStepStatus'

const run = (props) => renderHook(() => useWizardStepStatus(props)).result.current

describe('useWizardStepStatus', () => {
  describe('stepStates', () => {
    it('is empty when importJobs is the initial object (not an array)', () => {
      const { stepStates } = run({ currentStep: 'repoSelect', importJobs: { jobId: null } })
      expect(stepStates).toEqual({})
    })

    it('is empty when there are no jobs', () => {
      const { stepStates } = run({ currentStep: 'progress', importJobs: [] })
      expect(stepStates).toEqual({})
    })

    it('marks progress as error when any job failed (failed wins over running)', () => {
      const { stepStates } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'failed' }, { status: 'running' }],
      })
      expect(stepStates.progress).toBe('error')
    })

    it('marks progress as loading when a job is still running and none failed', () => {
      const { stepStates } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'running' }, { status: 'complete' }],
      })
      expect(stepStates.progress).toBe('loading')
    })

    it('treats pending and queued as running for the loading state', () => {
      expect(run({ currentStep: 'progress', importJobs: [{ status: 'pending' }] }).stepStates.progress).toBe('loading')
      expect(run({ currentStep: 'progress', importJobs: [{ status: 'queued' }] }).stepStates.progress).toBe('loading')
    })

    it('marks progress and summary done when every job completed', () => {
      const { stepStates } = run({
        currentStep: 'summary',
        importJobs: [{ status: 'complete' }, { status: 'completed' }],
      })
      expect(stepStates.progress).toBe('done')
      expect(stepStates.summary).toBe('done')
    })

    it('does not mark summary done while a job is still running', () => {
      const { stepStates } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'running' }, { status: 'complete' }],
      })
      expect(stepStates.summary).toBeUndefined()
    })
  })

  describe('currentStepStatusDetail', () => {
    it('is undefined when not on the progress step', () => {
      const { currentStepStatusDetail } = run({
        currentStep: 'repoSelect',
        importJobs: [{ status: 'running' }],
      })
      expect(currentStepStatusDetail).toBeUndefined()
    })

    it('is undefined on the progress step with no jobs', () => {
      const { currentStepStatusDetail } = run({ currentStep: 'progress', importJobs: [] })
      expect(currentStepStatusDetail).toBeUndefined()
    })

    it('reports a single running job in the singular', () => {
      const { currentStepStatusDetail } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'running' }],
      })
      expect(currentStepStatusDetail).toBe('1 job running')
    })

    it('reports multiple running jobs in the plural', () => {
      const { currentStepStatusDetail } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'running' }, { status: 'pending' }],
      })
      expect(currentStepStatusDetail).toBe('2 jobs running')
    })

    it('reports failures with the running count when any job failed', () => {
      const { currentStepStatusDetail } = run({
        currentStep: 'progress',
        importJobs: [{ status: 'failed' }, { status: 'running' }],
      })
      expect(currentStepStatusDetail).toBe('1 failed · 1 running')
    })
  })
})
