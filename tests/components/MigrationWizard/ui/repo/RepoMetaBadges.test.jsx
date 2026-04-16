import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoMetaBadges } from '../../../../../src/components/MigrationWizard/ui/repo/RepoMetaBadges'

describe('RepoMetaBadges', () => {
  const base = { name: 'foo', size: 2048, language: 'JavaScript', branches: 3 }

  it('renders language, size, branches', () => {
    render(<RepoMetaBadges repo={base} />)
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText(/2 MB/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows TFVC badge for tfvc repos', () => {
    render(<RepoMetaBadges repo={{ ...base, isTfvc: true }} />)
    expect(screen.getByText('TFVC')).toBeInTheDocument()
  })

  it('shows LFS marker when hasLfsMarker', () => {
    render(<RepoMetaBadges repo={{ ...base, hasLfsMarker: true }} />)
    expect(screen.getByText('LFS')).toBeInTheDocument()
  })

  it('shows relative last activity', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString()
    render(<RepoMetaBadges repo={{ ...base, lastCommitDate: threeDaysAgo }} />)
    expect(screen.getByText(/3d/)).toBeInTheDocument()
  })
})
