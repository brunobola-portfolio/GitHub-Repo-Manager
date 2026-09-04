import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// .env.test defaults VITE_MOCK_MODE=true, where useSourceStepForm skips the
// env-auth/oauth-status probes these tests exercise; force the real branch.
vi.stubEnv('VITE_MOCK_MODE', 'false')

const { default: SourceStep } = await import('../../../src/components/MigrationWizard/steps/SourceStep')

const mockOauthHook = {
  oauthStatus: 'idle',
  startOAuth: vi.fn(),
  retryOAuth: vi.fn(),
  pausePolling: vi.fn(),
  resumePolling: vi.fn(),
}

// apiCall's safeParseJson reads response.headers.get('content-type') and
// falls back to response.text() — both must be present on the mock Response.
const JSON_HEADERS = { get: (k) => (k?.toLowerCase?.() === 'content-type' ? 'application/json' : null) }
function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: JSON_HEADERS,
  })
}

// Mock fetch globally
beforeEach(() => {
  global.fetch = vi.fn(() => jsonResponse({ available: false, configured: false }))
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
      return jsonResponse(body)
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
