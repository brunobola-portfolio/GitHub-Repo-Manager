import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewToolbar } from '@/components/PRReview/ReviewToolbar/ReviewToolbar'

// repoFullName intentionally omitted from every render below so TrackedChip
// (which talks to useTrackedRepos) never mounts — this test is scoped to the
// newly-promoted PRRiskBadges ride-along, not the tracking chip.

describe('ReviewToolbar — promoted PR-level risk badges', () => {
  it('surfaces heuristic risk pills for a stale, unassigned open PR', () => {
    const staleOpenPr = {
      number: 42,
      title: 'Test PR',
      state: 'open',
      draft: false,
      body: 'x'.repeat(80),
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      requested_reviewers: [],
      requested_teams: [],
      assignees: [],
    }
    render(
      <ReviewToolbar
        pr={staleOpenPr}
        viewMode="split"
        onToggleViewMode={vi.fn()}
        onBack={vi.fn()}
        onSubmitReview={vi.fn()}
      />,
    )
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
    expect(screen.getByText(/no reviewers/i)).toBeInTheDocument()
  })

  it('renders no risk badges for a PR with no heuristic signals', () => {
    const cleanPr = { number: 1, title: 'Clean PR', state: 'closed' }
    render(
      <ReviewToolbar
        pr={cleanPr}
        viewMode="split"
        onToggleViewMode={vi.fn()}
        onBack={vi.fn()}
        onSubmitReview={vi.fn()}
      />,
    )
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()
  })

  it('does not blow up when pr is absent', () => {
    render(
      <ReviewToolbar
        viewMode="split"
        onToggleViewMode={vi.fn()}
        onBack={vi.fn()}
        onSubmitReview={vi.fn()}
      />,
    )
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})

/*
 * Mobile: PRReviewView hides its left file-tree column below md and exposes
 * the list through this toolbar button instead (bottom sheet), mirroring
 * CodeReviewSurface. Without it a phone showed a 256px tree beside a diff
 * column a few characters wide.
 */
describe('ReviewToolbar — mobile files button', () => {
  it('renders a "Files (N)" trigger that opens the mobile sheet', () => {
    const onOpenFiles = vi.fn()
    render(
      <ReviewToolbar
        pr={{ number: 1, title: 'Clean PR', state: 'open' }}
        viewMode="unified"
        onToggleViewMode={vi.fn()}
        onBack={vi.fn()}
        onSubmitReview={vi.fn()}
        filesCount={2}
        onOpenFiles={onOpenFiles}
      />,
    )
    const btn = screen.getByRole('button', { name: /open files list \(2\)/i })
    expect(btn.className).toMatch(/\bmd:hidden\b/)
    btn.click()
    expect(onOpenFiles).toHaveBeenCalledTimes(1)
  })

  it('omits the trigger when no handler is supplied', () => {
    render(
      <ReviewToolbar
        pr={{ number: 1, title: 'Clean PR', state: 'open' }}
        viewMode="unified"
        onToggleViewMode={vi.fn()}
        onBack={vi.fn()}
        onSubmitReview={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /open files list/i })).toBeNull()
  })
})
