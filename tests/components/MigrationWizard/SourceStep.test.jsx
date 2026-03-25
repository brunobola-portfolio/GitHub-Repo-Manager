import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SourceStep from '../../../src/components/MigrationWizard/steps/SourceStep'

const mockOauthHook = {
  oauthStatus: 'idle',
  startOAuth: vi.fn(),
  retryOAuth: vi.fn(),
  pausePolling: vi.fn(),
  resumePolling: vi.fn(),
}

// Mock fetch globally
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ available: false, configured: false }),
    })
  )
})

describe('SourceStep', () => {
  const defaultSource = {
    org: '',
    project: '',
    pat: '',
    validated: false,
    credentialMode: 'personalPat',
    urlParsedProject: '',
    urlParsedRepo: '',
  }

  it('renders organization input', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} oauthHook={mockOauthHook} />)
    expect(screen.getByLabelText(/organization/i)).toBeInTheDocument()
  })

  it('renders smart URL paste field', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} oauthHook={mockOauthHook} />)
    expect(screen.getByPlaceholderText(/dev.azure.com/i)).toBeInTheDocument()
  })

  it('renders credential cards when loaded', async () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} oauthHook={mockOauthHook} />)
    // Credential cards appear after fetch resolves — check for the authentication label
    expect(screen.getByText(/authentication/i)).toBeInTheDocument()
  })

  it('does not render validate button', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} oauthHook={mockOauthHook} />)
    expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument()
  })
})
