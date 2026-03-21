import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SourceStep from '../../../src/components/MigrationWizard/steps/SourceStep'

// Mock fetch globally
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ available: false }),
    })
  )
})

describe('SourceStep', () => {
  const defaultSource = { type: 'azure', org: '', project: '', pat: '', validated: false }

  it('renders organization input', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/organization/i)).toBeInTheDocument()
  })

  it('renders PAT input as password by default', () => {
    render(<SourceStep source={{ ...defaultSource, pat: 'secret' }} onChange={vi.fn()} />)
    const input = screen.getByLabelText(/personal access token/i)
    expect(input.type).toBe('password')
  })

  it('renders validate button', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument()
  })

  it('disables validate button when org is empty', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /validate/i })).toBeDisabled()
  })

  it('renders heading text', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} />)
    expect(screen.getByText('Azure DevOps Source')).toBeInTheDocument()
  })
})
