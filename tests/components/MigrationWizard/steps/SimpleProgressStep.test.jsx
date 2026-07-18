import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SimpleProgressStep from '../../../../src/components/MigrationWizard/steps/SimpleProgressStep'

describe('SimpleProgressStep — cancel + honest status rendering', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
  })

  afterEach(() => {
    delete global.fetch
    vi.restoreAllMocks()
  })

  describe('single import', () => {
    it('shows a Cancel control before the first poll response lands (job already exists server-side)', async () => {
      const importJobs = { jobId: 42, importing: true, jobStatus: null }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i })
      await userEvent.click(cancelBtn)

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/import/42/cancel',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('shows a Cancel control for a running job and posts to the cancel endpoint on click', async () => {
      const importJobs = {
        jobId: 42,
        importing: true,
        jobStatus: { status: 'running', progressPct: 40, progressMessage: 'Cloning...' },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
      await userEvent.click(cancelBtn)

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/import/42/cancel',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
    })

    it('hides the Cancel control once the job has reached a terminal status', () => {
      const importJobs = {
        jobId: 42,
        importing: false,
        jobStatus: {
          status: 'completed',
          progressPct: 100,
          progressMessage: 'Import completed successfully!',
          metadata: { repoUrl: 'https://github.com/acme/widget' },
        },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
      expect(screen.getByText('View repository')).toBeInTheDocument()
    })

    it('renders a distinct, non-error "Cancelled" state — never conflated with Failed', () => {
      const importJobs = {
        jobId: 42,
        importing: false,
        jobStatus: { status: 'cancelled', progressPct: 60, progressMessage: 'Migration cancelled' },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.getByText('Cancelled')).toBeInTheDocument()
      expect(screen.getByText('Migration cancelled.')).toBeInTheDocument()
      expect(screen.queryByText(/^Failed$/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    })

    it('renders an "Interrupted" state with the recovery error message for a job orphaned by a server restart', () => {
      const importJobs = {
        jobId: 42,
        importing: false,
        jobStatus: {
          status: 'interrupted',
          progressPct: 55,
          progressMessage: 'Pushing to GitHub...',
          errorMessage: 'Interrupted by a server restart',
        },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.getByText('Interrupted')).toBeInTheDocument()
      expect(screen.getByText('Interrupted by a server restart')).toBeInTheDocument()
    })

    it('disables the Cancel button while the request is in flight and re-enables it if the request fails', async () => {
      let resolveFetch
      global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

      const importJobs = {
        jobId: 7,
        importing: true,
        jobStatus: { status: 'running', progressPct: 10, progressMessage: '' },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
      await userEvent.click(cancelBtn)

      const pending = await screen.findByRole('button', { name: /cancelling/i })
      expect(pending).toBeDisabled()

      resolveFetch({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^cancel$/i })).not.toBeDisabled()
      })
    })
  })

  describe('batch import', () => {
    it('shows a per-job Cancel control only for non-terminal jobs', () => {
      const importJobs = {
        batchJobs: [
          { jobId: 1, repoName: 'repo-a' },
          { jobId: 2, repoName: 'repo-b' },
        ],
        importing: true,
        batchStatuses: {
          1: { status: 'running', progressPct: 30 },
          2: { status: 'completed', progressPct: 100 },
        },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(1)
    })

    it("posts to the clicked job's own cancel endpoint", async () => {
      const importJobs = {
        batchJobs: [{ jobId: 5, repoName: 'repo-c' }],
        importing: true,
        batchStatuses: { 5: { status: 'pending' } },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const cancelBtn = screen.getByRole('button', { name: /cancel import of repo-c/i })
      await userEvent.click(cancelBtn)

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/import/5/cancel',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('counts a cancelled job toward the completed tally instead of stalling the overall progress bar', () => {
      const importJobs = {
        batchJobs: [
          { jobId: 1, repoName: 'repo-a' },
          { jobId: 2, repoName: 'repo-b' },
        ],
        importing: true,
        batchStatuses: {
          1: { status: 'cancelled', progressPct: 40 },
          2: { status: 'running', progressPct: 10 },
        },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.getByText('1/2 completed')).toBeInTheDocument()
      expect(screen.getByText('Import cancelled.')).toBeInTheDocument()
    })
  })
})
