import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RiskBadge } from '../../../../src/components/MigrationWizard/ui/repo/RiskBadge'

describe('RiskBadge', () => {
  it('returns null when level is ok', () => {
    const { container } = render(<RiskBadge level="ok" flags={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders blocker with count', () => {
    const flags = [
      { type: 'size-critical', severity: 'blocker', message: 'Too big' },
      { type: 'name-conflict', severity: 'blocker', message: 'Duplicate' },
    ]
    render(<RiskBadge level="blocker" flags={flags} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', expect.stringMatching(/2 blocker/i))
  })

  it('uses amber styling for warning', () => {
    const flags = [{ type: 'lfs-suggested', severity: 'warning', message: 'LFS' }]
    render(<RiskBadge level="warning" flags={flags} />)
    expect(screen.getByRole('button').className).toMatch(/amber/)
  })
})
