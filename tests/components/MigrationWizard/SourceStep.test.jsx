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
    expect(screen.getByText(/authentica/i)).toBeInTheDocument()
  })

  it('does not render validate button', () => {
    render(<SourceStep source={defaultSource} onChange={vi.fn()} oauthHook={mockOauthHook} />)
    expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument()
  })

  // Regression: the amber "Server PAT is configured … detected an on-premises
  // TFS server (<host>)" warning fired whenever the provider wasn't cloud —
  // including the UNKNOWN state before any URL was pasted — printing an empty
  // "()" and falsely claiming a server was detected.
  describe('Server PAT on-prem warning (no false detection)', () => {
    const envAuthFetch = (url) => {
      const body = url.includes('/api/azure/env-auth') ? { available: true }
        : url.includes('/api/azure/oauth-status') ? { configured: false }
        : {}
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    }

    it('does NOT warn about on-prem before any host is detected', async () => {
      global.fetch = vi.fn(envAuthFetch)
      render(
        <SourceStep
          source={{ ...defaultSource, host: '', credentialMode: 'serverPat' }}
          onChange={vi.fn()}
          oauthHook={mockOauthHook}
        />,
      )
      // Wait until the env-auth probe resolved (Server PAT card shows its .env
      // hint) so a regression would have had every chance to render the warning.
      await screen.findByText(/AZURE_PAT detected in \.env/i)
      expect(screen.queryByText(/detected an on-premises TFS server/i)).not.toBeInTheDocument()
    })

    it('warns about on-prem once a real on-prem host is detected', async () => {
      global.fetch = vi.fn(envAuthFetch)
      render(
        <SourceStep
          source={{ ...defaultSource, host: 'tfs.empresa.com', credentialMode: 'serverPat' }}
          onChange={vi.fn()}
          oauthHook={mockOauthHook}
        />,
      )
      expect(await screen.findByText(/detected an on-premises TFS server/i)).toBeInTheDocument()
    })
  })
})
