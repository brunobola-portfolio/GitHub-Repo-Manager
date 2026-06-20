import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SummaryStep from '../../../../src/components/MigrationWizard/steps/SummaryStep'
import { migrationApi } from '../../../../src/api/migration'

vi.mock('../../../../src/api/migration', () => ({
  migrationApi: { getReport: vi.fn() },
}))

const report = {
  plan: { status: 'completed', durationSeconds: 10 },
  summary: { total: 1, success: 0, failed: 1, skipped: 0 },
  tasks: [{ id: 1, type: 'repo', status: 'failed', sourceRef: 'a/b/AITOOL', targetRef: 'BolaLabs/AITOOL', durationSeconds: 10 }],
  errors: [{ taskId: 1, type: 'repo', targetRef: 'BolaLabs/AITOOL', error: 'Repository "BolaLabs/AITOOL" already exists on GitHub and is not empty.', suggestion: 'Rename or delete it.' }],
}

describe('SummaryStep conflict recovery', () => {
  beforeEach(() => { migrationApi.getReport.mockResolvedValue(report) })

  it('shows Replace & retry on a conflict error; fires onReplaceRetry after type-to-confirm', async () => {
    const onReplaceRetry = vi.fn()
    render(<SummaryStep planId="p1" onReplaceRetry={onReplaceRetry} />)
    const btn = await screen.findByRole('button', { name: /replace.*retry/i })
    fireEvent.click(btn)
    // Destructive confirm gate: button stays disabled until the exact name is typed.
    const input = await screen.findByPlaceholderText('BolaLabs/AITOOL')
    fireEvent.change(input, { target: { value: 'BolaLabs/AITOOL' } })
    fireEvent.click(screen.getByRole('button', { name: /delete.*replace/i }))
    expect(onReplaceRetry).toHaveBeenCalledWith(expect.objectContaining({ taskId: 1 }))
  })

  it('does NOT show Replace & retry for a repo-type error that is not a conflict', async () => {
    const nonConflictReport = {
      plan: { status: 'completed', durationSeconds: 5 },
      summary: { total: 1, success: 0, failed: 1, skipped: 0 },
      tasks: [{ id: 2, type: 'repo', status: 'failed', sourceRef: 'org/repo', targetRef: 'dest/repo', durationSeconds: 5 }],
      // Error message does not contain "already exists" — unrelated auth failure
      errors: [{ taskId: 2, type: 'repo', targetRef: 'dest/repo', error: 'Authentication failed' }],
    }
    migrationApi.getReport.mockResolvedValueOnce(nonConflictReport)
    render(<SummaryStep planId="p2" onReplaceRetry={vi.fn()} />)
    // First error card is auto-expanded (index === 0), so the button would be
    // visible if the guard were wrong — wait for the error card to appear first
    await screen.findByText('Authentication failed')
    expect(screen.queryByRole('button', { name: /replace.*retry/i })).toBeNull()
  })

  it('does NOT show Replace & retry for a non-repo "already exists" error', async () => {
    const workItemsConflictReport = {
      plan: { status: 'completed', durationSeconds: 5 },
      summary: { total: 1, success: 0, failed: 1, skipped: 0 },
      tasks: [{ id: 3, type: 'work-items', status: 'failed', sourceRef: 'org/proj', targetRef: 'dest/proj', durationSeconds: 5 }],
      // "already exists" but for a work-items task — Replace flow does not apply
      errors: [{ taskId: 3, type: 'work-items', error: 'A label already exists with this name' }],
    }
    migrationApi.getReport.mockResolvedValueOnce(workItemsConflictReport)
    render(<SummaryStep planId="p3" onReplaceRetry={vi.fn()} />)
    // First error card is auto-expanded — wait for content to render
    await screen.findByText('A label already exists with this name')
    expect(screen.queryByRole('button', { name: /replace.*retry/i })).toBeNull()
  })

  it('shows Retry with Git LFS on an oversized-files error and fires onLfsRetry', async () => {
    const oversizedReport = {
      plan: { status: 'failed', durationSeconds: 55 },
      summary: { total: 1, success: 0, failed: 1, skipped: 0 },
      tasks: [{ id: 12, type: 'repo', status: 'failed', sourceRef: 'a/b/AITOOL', targetRef: 'BolaLabs/AITOOL', durationSeconds: 55 }],
      errors: [{
        taskId: 12, type: 'repo', targetRef: 'BolaLabs/AITOOL',
        error: 'OVERSIZED_FILES:{"files":[{"path":"Lib/StdMigrador100.dll","sizeMB":197}]}|3 file(s) exceeded GitHub\'s 100 MB limit during push.',
      }],
    }
    migrationApi.getReport.mockResolvedValueOnce(oversizedReport)
    const onLfsRetry = vi.fn()
    render(<SummaryStep planId="p5" onLfsRetry={onLfsRetry} />)
    const btn = await screen.findByRole('button', { name: /retry with git lfs/i })
    fireEvent.click(btn)
    expect(onLfsRetry).toHaveBeenCalledWith(expect.objectContaining({ taskId: 12 }))
  })

  it('shows a "Replaced" badge for a repo task completed with replacedExistingRepo metadata', async () => {
    const replacedReport = {
      plan: { status: 'completed', durationSeconds: 8 },
      summary: { total: 1, success: 1, failed: 0, skipped: 0 },
      tasks: [
        {
          id: 4,
          type: 'repo',
          status: 'completed',
          sourceRef: 'org/old-repo',
          targetRef: 'dest/old-repo',
          durationSeconds: 8,
          metadata: { replacedExistingRepo: true },
        },
      ],
      errors: [],
    }
    migrationApi.getReport.mockResolvedValueOnce(replacedReport)
    render(<SummaryStep planId="p4" />)
    expect(await screen.findByText(/replaced/i)).toBeTruthy()
  })

  it('shows an "LFS upload failed" badge when lfsPushFailed metadata is set', async () => {
    const lfsReport = {
      plan: { status: 'completed', durationSeconds: 12 },
      summary: { total: 1, success: 1, failed: 0, skipped: 0 },
      tasks: [
        {
          id: 6,
          type: 'repo',
          status: 'completed',
          sourceRef: 'org/lfs-repo',
          targetRef: 'dest/lfs-repo',
          durationSeconds: 12,
          metadata: { lfsPushFailed: true },
        },
      ],
      errors: [],
    }
    migrationApi.getReport.mockResolvedValueOnce(lfsReport)
    render(<SummaryStep planId="p6" />)
    expect(await screen.findByText(/lfs upload failed/i)).toBeTruthy()
  })
})
