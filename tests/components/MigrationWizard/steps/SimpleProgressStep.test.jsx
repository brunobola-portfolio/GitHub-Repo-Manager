import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SimpleProgressStep from '../../../../src/components/MigrationWizard/steps/SimpleProgressStep'

// Drives the fake-timer 2s poll interval forward one tick and lets any
// pending microtasks (the async fetch handler) flush before returning.
// Wrapped in act() so the resulting setState calls are applied and flushed
// synchronously w.r.t. the test — findBy/waitFor's own polling can't drive
// fake timers forward, so the state must already be settled by the time we
// assert.
async function advancePoll(ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
  }
}

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

  describe('ARIA parity with ProgressStep', () => {
    it('exposes the single-import progress bar as a labeled progressbar with value bounds', () => {
      const importJobs = {
        jobId: 42,
        importing: true,
        jobStatus: { status: 'running', progressPct: 40, progressMessage: 'Cloning...' },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const bar = screen.getByRole('progressbar', { name: /import progress/i })
      expect(bar).toHaveAttribute('aria-valuenow', '40')
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
    })

    it('renders an aria-live status region announcing the current single-import state', () => {
      const importJobs = {
        jobId: 42,
        importing: true,
        jobStatus: { status: 'running', progressPct: 40, progressMessage: 'Cloning...' },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.getByRole('status')).toHaveTextContent('Cloning...')
    })

    it('exposes the batch overall progress bar as a labeled progressbar and announces batch progress via aria-live', () => {
      const importJobs = {
        batchJobs: [
          { jobId: 1, repoName: 'repo-a' },
          { jobId: 2, repoName: 'repo-b' },
        ],
        importing: true,
        batchStatuses: {
          1: { status: 'completed', progressPct: 100 },
          2: { status: 'running', progressPct: 30 },
        },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      const overallBar = screen.getByRole('progressbar', { name: /overall import progress/i })
      expect(overallBar).toHaveAttribute('aria-valuenow', '50')
      expect(screen.getByRole('status')).toHaveTextContent('1 of 2 imports completed')

      // Per-job progress bar for the still-running job is its own labeled progressbar.
      expect(screen.getByRole('progressbar', { name: /import progress for repo-b/i })).toHaveAttribute('aria-valuenow', '30')
    })
  })

  describe('background-tab polling gate', () => {
    let hidden = false
    let originalHidden

    beforeEach(() => {
      hidden = false
      originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    })
    afterEach(() => {
      delete document.hidden
      if (originalHidden) Object.defineProperty(Document.prototype, 'hidden', originalHidden)
      vi.useRealTimers()
    })

    async function setHidden(next) {
      hidden = next
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    }

    it('stops polling a single import while the tab is hidden and re-syncs the moment it returns', async () => {
      vi.useFakeTimers()
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'running', progressPct: 50 }) }))

      const importJobs = { jobId: 42, importing: true, jobStatus: { status: 'running', progressPct: 10 } }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      await advancePoll(1)
      expect(global.fetch).toHaveBeenCalledTimes(1)

      await setHidden(true)
      await advancePoll(3)
      // Three interval periods elapsed with the tab in the background — a
      // 20-repo batch at this cadence was 10 req/s of pure waste.
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Returning must reconcile at once: pausing the poll must never leave a
      // running migration showing a frozen progress bar.
      await setHidden(false)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('stops every batch job timer while hidden and ticks each one on return', async () => {
      vi.useFakeTimers()
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'running', progressPct: 20 }) }))

      const importJobs = {
        batchJobs: [{ jobId: 1, repoName: 'repo-a' }, { jobId: 2, repoName: 'repo-b' }],
        importing: true,
        batchStatuses: { 1: { status: 'running' }, 2: { status: 'running' } },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      await advancePoll(1)
      expect(global.fetch).toHaveBeenCalledTimes(2) // one per job

      await setHidden(true)
      await advancePoll(3)
      expect(global.fetch).toHaveBeenCalledTimes(2)

      await setHidden(false)
      expect(global.fetch).toHaveBeenCalledTimes(4) // both jobs re-checked at once
    })
  })

  describe('connection-lost indicator (stale/reconnect polling)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows a "Connection lost — retrying" pill after 3 consecutive failed single-import polls, and clears it on the next success', async () => {
      vi.useFakeTimers()
      let calls = 0
      global.fetch = vi.fn(async () => {
        calls++
        if (calls <= 3) return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, json: async () => ({ status: 'running', progressPct: 50 }) }
      })

      const importJobs = { jobId: 42, importing: true, jobStatus: { status: 'running', progressPct: 10 } }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument()

      await advancePoll(2) // 2 failures — still under threshold
      expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument()

      await advancePoll(1) // 3rd consecutive failure — threshold reached
      // The visible pill's exact copy — distinct from the sr-only aria-live
      // announcement text ("Connection lost, retrying") so this doesn't
      // accidentally match two elements.
      expect(screen.getByText('Connection lost — retrying')).toBeInTheDocument()

      await advancePoll(1) // next poll succeeds — pill clears
      // State is already flushed by advancePoll's act() wrapper — a real
      // waitFor here would hang forever under fake timers (its own polling
      // setTimeout never fires without an explicit timer advance).
      expect(screen.queryByText('Connection lost — retrying')).not.toBeInTheDocument()
    })

    it('shows the connection-lost pill for stalled batch polling too, sharing the same failure counter', async () => {
      vi.useFakeTimers()
      let calls = 0
      global.fetch = vi.fn(async () => {
        calls++
        if (calls <= 3) return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, json: async () => ({ status: 'running', progressPct: 20 }) }
      })

      const importJobs = {
        batchJobs: [{ jobId: 1, repoName: 'repo-a' }],
        importing: true,
        batchStatuses: { 1: { status: 'running', progressPct: 10 } },
      }
      render(<SimpleProgressStep importJobs={importJobs} onUpdate={() => {}} source={{}} />)

      await advancePoll(3)
      // The visible pill's exact copy — distinct from the sr-only aria-live
      // announcement text ("Connection lost, retrying") so this doesn't
      // accidentally match two elements.
      expect(screen.getByText('Connection lost — retrying')).toBeInTheDocument()
    })
  })
})
