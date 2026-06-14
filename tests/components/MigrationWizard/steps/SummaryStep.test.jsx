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
  errors: [{ taskId: 1, type: 'repo', error: 'Repository "BolaLabs/AITOOL" already exists on GitHub and is not empty.', suggestion: 'Rename or delete it.' }],
}

describe('SummaryStep conflict recovery', () => {
  beforeEach(() => { migrationApi.getReport.mockResolvedValue(report) })

  it('shows a Resolve conflict button on an "already exists" error and fires onResolveConflict', async () => {
    const onResolveConflict = vi.fn()
    render(<SummaryStep planId="p1" onResolveConflict={onResolveConflict} />)
    const btn = await screen.findByRole('button', { name: /resolve conflict/i })
    fireEvent.click(btn)
    expect(onResolveConflict).toHaveBeenCalledWith(expect.objectContaining({ taskId: 1 }))
  })
})
