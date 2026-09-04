import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  // Regression (FE-14): the edit buffer used to resync from `host` via a
  // follow-up effect; this exercises the render-time replacement directly —
  // an external host change (e.g. a URL pasted elsewhere in the wizard)
  // updates the readout, and a fresh edit still seeds correctly from it.
  it('resyncs the readout when `host` changes externally, without losing edit behaviour', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ServerPicker host="tfs.corp.com" onHostChange={noop} />)
    expect(screen.getByText('tfs.corp.com')).toBeInTheDocument()

    rerender(<ServerPicker host="tfs2.corp.com" onHostChange={noop} />)
    expect(screen.getByText('tfs2.corp.com')).toBeInTheDocument()
    expect(screen.queryByText('tfs.corp.com')).not.toBeInTheDocument()

    // Entering edit mode still seeds the input from the current (updated) host.
    await user.click(screen.getByRole('button', { name: /edit server/i }))
    expect(screen.getByPlaceholderText(/tfs.company.com/i)).toHaveValue('tfs2.corp.com')
  })
})
