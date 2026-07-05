import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../../src/hooks/useSSE', () => ({
  useSSE: () => ({ events: [], connected: true }),
}))
vi.mock('../../../../src/api/migration', () => ({
  migrationApi: {
    streamUrl: vi.fn(() => '/api/migration/plans/1/stream'),
    getPlan: vi.fn(),
    pausePlan: vi.fn(),
    cancelPlan: vi.fn(),
    resumePlan: vi.fn(),
  },
}))

import ProgressStep from '../../../../src/components/MigrationWizard/steps/ProgressStep'
import { migrationApi } from '../../../../src/api/migration'

describe('ProgressStep controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a Resume control for a paused plan and calls resumePlan', async () => {
    migrationApi.getPlan.mockResolvedValue({ tasks: [], status: 'paused' })
    migrationApi.resumePlan.mockResolvedValue({ success: true })

    render(<ProgressStep planId={1} />)

    const resume = await screen.findByRole('button', { name: /resume/i })
    await userEvent.click(resume)

    expect(migrationApi.resumePlan).toHaveBeenCalledWith(1)
    // After resuming, the control flips back to Pause
    await screen.findByRole('button', { name: /pause/i })
  })

  it('paused state is announced via the status live region', async () => {
    migrationApi.getPlan.mockResolvedValue({ tasks: [], status: 'paused' })

    render(<ProgressStep planId={1} />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Migration paused')
    })
  })

  it('exposes overall progress as a progressbar', async () => {
    migrationApi.getPlan.mockResolvedValue({
      tasks: [
        { id: 1, type: 'repo', status: 'complete' },
        { id: 2, type: 'repo', status: 'running' },
      ],
      status: 'running',
    })

    render(<ProgressStep planId={1} />)

    const bar = await screen.findByRole('progressbar', { name: /overall migration progress/i })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
  })

  it('renders a recoverable error state when the initial load fails, and retries', async () => {
    migrationApi.getPlan
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ tasks: [], status: 'running' })

    render(<ProgressStep planId={1} />)

    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(screen.getByText(/couldn't load migration progress/i)).toBeInTheDocument()

    await userEvent.click(retry)

    await waitFor(() => {
      expect(migrationApi.getPlan).toHaveBeenCalledTimes(2)
    })
    // Error state cleared, live view rendered
    expect(await screen.findByText(/0\/0 tasks completed/i)).toBeInTheDocument()
  })
})
