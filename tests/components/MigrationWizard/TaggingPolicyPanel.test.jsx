import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaggingPolicyPanel } from '../../../src/components/MigrationWizard/steps/TaggingPolicyPanel.jsx'
import { DEFAULT_TAGGING_POLICY } from '../../../src/components/MigrationWizard/steps/taggingDefaults.js'

describe('<TaggingPolicyPanel>', () => {
  it('renders all toggles ON by default', () => {
    render(<TaggingPolicyPanel policy={DEFAULT_TAGGING_POLICY} onChange={() => {}} />)
    expect(screen.getByLabelText(/ativar marca/i)).toBeChecked()
    expect(screen.getByLabelText(/marcar destino/i)).toBeChecked()
    expect(screen.getByLabelText(/marcar origem/i)).toBeChecked()
    expect(screen.getByLabelText(/git tag anotada/i)).toBeChecked()
    expect(screen.getByLabelText(/ocultar nome da origem/i)).not.toBeChecked()
  })

  it('calls onChange when source toggled', () => {
    const onChange = vi.fn()
    render(<TaggingPolicyPanel policy={DEFAULT_TAGGING_POLICY} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/marcar origem/i))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ writeSource: false }))
  })

  it('disables nested fieldset when master switch is off', () => {
    const policy = { ...DEFAULT_TAGGING_POLICY, enabled: false }
    render(<TaggingPolicyPanel policy={policy} onChange={() => {}} />)
    const fieldset = screen.getByLabelText(/onde marcar/i)
    expect(fieldset).toBeDisabled()
  })

  it('shows warning when capabilities flag missing scopes', () => {
    render(
      <TaggingPolicyPanel
        policy={DEFAULT_TAGGING_POLICY}
        onChange={() => {}}
        capabilities={{ azure: { missingScopes: ['vso.project_manage'] } }}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/vso\.project_manage/)
  })

  it('toggles privacy switch independently', () => {
    const onChange = vi.fn()
    render(<TaggingPolicyPanel policy={DEFAULT_TAGGING_POLICY} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/ocultar nome da origem/i))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideSourceName: true }))
  })
})
