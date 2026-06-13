import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ServerPicker from '@/components/MigrationWizard/steps/SourceStep/ServerPicker'

// The Cloud / On-prem presets must reflect the host the wizard detected from a
// pasted URL, so the choice is automatic. `aria-pressed` is the source of truth
// (also the correct toggle-button a11y semantics).
describe('ServerPicker — auto-selects cloud/on-prem from the detected host', () => {
  const noop = () => {}

  it('auto-selects Cloud for dev.azure.com', () => {
    render(<ServerPicker host="dev.azure.com" onHostChange={noop} />)
    expect(screen.getByRole('button', { name: /cloud/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /on-prem/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('auto-selects Cloud for legacy *.visualstudio.com (VSTS routes to cloud)', () => {
    render(<ServerPicker host="brunobola.visualstudio.com" onHostChange={noop} />)
    expect(screen.getByRole('button', { name: /cloud/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /on-prem/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('auto-selects On-prem for a TFS host', () => {
    render(<ServerPicker host="tfs.corp.com" onHostChange={noop} />)
    expect(screen.getByRole('button', { name: /on-prem/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /cloud/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('selects neither preset before a host is set', () => {
    render(<ServerPicker host="" onHostChange={noop} />)
    expect(screen.getByRole('button', { name: /cloud/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /on-prem/i })).toHaveAttribute('aria-pressed', 'false')
  })
})
