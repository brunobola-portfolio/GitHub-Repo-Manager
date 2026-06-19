import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoRiskReport } from '../../../../src/components/MigrationWizard/ui/repo/RepoRiskReport'

// The Repos-step conflict resolution is delivered through the existing
// per-flag action mechanism: a name-conflict flag renders Replace/Rename/Skip
// and fires onAction(id), which RepoSelectStep.handleRiskAction routes.
describe('RepoRiskReport conflict actions', () => {
  it('renders replace/rename/skip and fires onAction with the id', () => {
    const onAction = vi.fn()
    render(
      <RepoRiskReport
        flags={[{
          type: 'name-conflict', severity: 'blocker', message: 'exists',
          actions: [
            { id: 'replace', label: 'Replace' },
            { id: 'rename', label: 'Rename' },
            { id: 'skip', label: 'Skip' },
          ],
        }]}
        onAction={onAction}
      />
    )
    fireEvent.click(screen.getByText('Replace'))
    expect(onAction).toHaveBeenCalledWith('replace')
    fireEvent.click(screen.getByText('Skip'))
    expect(onAction).toHaveBeenCalledWith('skip')
  })
})
