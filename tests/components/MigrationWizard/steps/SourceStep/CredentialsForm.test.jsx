import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import CredentialsForm from '@/components/MigrationWizard/steps/SourceStep/CredentialsForm'

// Regression for the "misleading on-prem detection" bug: several credential
// hints gated on `!isCloud`, which is true for BOTH a real on-prem host AND the
// UNKNOWN "nothing pasted yet" provider. That made the wizard assert "TFS
// on-premises" (and interpolate an empty {source.host}) before any URL existed.
// The copy must only claim on-prem once a real on-prem host is classified.

const noop = () => {}

function renderForm(sourceOverrides = {}, props = {}) {
  const source = {
    host: '',
    org: '',
    credentialMode: 'serverPat',
    pat: '',
    savedCredentialId: null,
    ...sourceOverrides,
  }
  return render(
    <CredentialsForm
      source={source}
      onChange={noop}
      credLoading={false}
      envAuthAvailable={true}
      oauthConfigured={false}
      oauthStatusValue="idle"
      startOAuth={noop}
      retryOAuth={noop}
      showPat={false}
      setShowPat={noop}
      handleModeSwitch={noop}
      setValidationError={noop}
      {...props}
    />,
  )
}

afterEach(cleanup)

describe('CredentialsForm — Server PAT env hint (no false on-prem claim)', () => {
  it('shows a clean hint with no on-prem caveat before a host is detected (UNKNOWN)', () => {
    renderForm({ host: '' })
    expect(screen.getByText(/AZURE_PAT detectado em \.env/i)).toBeInTheDocument()
    expect(screen.queryByText(/pode falhar contra TFS on-prem/i)).not.toBeInTheDocument()
  })

  it('shows the on-prem caveat only once a real on-prem host is detected', () => {
    renderForm({ host: 'tfs.empresa.com' })
    expect(screen.getByText(/pode falhar contra TFS on-prem/i)).toBeInTheDocument()
  })

  it('keeps a clean hint for a cloud host (no caveat)', () => {
    renderForm({ host: 'dev.azure.com' })
    expect(screen.getByText(/AZURE_PAT detectado em \.env/i)).toBeInTheDocument()
    expect(screen.queryByText(/pode falhar contra TFS on-prem/i)).not.toBeInTheDocument()
  })
})

describe('CredentialsForm — OAuth card (no false on-prem claim, no empty host)', () => {
  it('does NOT claim on-prem or render an empty host before detection (UNKNOWN)', () => {
    renderForm({ host: '' })
    // Neutral "paste a URL" copy, not the on-prem assertion…
    expect(screen.getByText(/só funciona com Azure DevOps cloud/i)).toBeInTheDocument()
    expect(screen.queryByText(/não está disponível para TFS on-premises/i)).not.toBeInTheDocument()
    // …and the "Para autenticares em <host>" line (which would show an empty
    // host) must not render at all.
    expect(screen.queryByText(/Para autenticares em/i)).not.toBeInTheDocument()
  })

  it('shows the on-prem OAuth copy with the host once a real on-prem host is detected', () => {
    renderForm({ host: 'tfs.empresa.com' })
    expect(screen.getByText(/não está disponível para TFS on-premises/i)).toBeInTheDocument()
    expect(screen.getByText(/Para autenticares em/i)).toBeInTheDocument()
    expect(screen.getByText('tfs.empresa.com')).toBeInTheDocument()
  })
})
