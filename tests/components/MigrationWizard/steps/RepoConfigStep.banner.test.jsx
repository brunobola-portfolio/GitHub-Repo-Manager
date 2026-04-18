import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RepoConfigStep from '../../../../src/components/MigrationWizard/steps/RepoConfigStep.jsx'

function renderStep(overrides = {}) {
  const props = {
    repos: [{ id: 1, name: 'demo', selected: true, targetName: 'demo' }],
    onUpdateRepo: vi.fn(),
    source: {
      sourceType: 'azure',
      validated: false,
      org: 'bruno',
      project: 'AWIP',
      targetOrg: 'bolalabs',
      targetName: 'demo',
    },
    orgs: [{ login: 'bolalabs' }],
    onChangeDestination: vi.fn(),
    onGoToStep: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<RepoConfigStep {...props} />) }
}

describe('RepoConfigStep — credentials banner', () => {
  it('shows a banner when Azure source is not validated', () => {
    renderStep()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/credenciais|valida/i)).toBeInTheDocument()
  })

  it('renders a button that navigates to azureConnect when clicked', () => {
    const { props } = renderStep()
    const button = screen.getByRole('button', { name: /connect|ligar|validar/i })
    fireEvent.click(button)
    expect(props.onGoToStep).toHaveBeenCalledWith('azureConnect')
  })

  it('does not show the banner when Azure source is validated', () => {
    renderStep({ source: { sourceType: 'azure', validated: true, org: 'x', project: 'y', targetOrg: 'z', targetName: 'n' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not show the banner for non-Azure sourceType (e.g. github)', () => {
    renderStep({ source: { sourceType: 'github', validated: false, targetOrg: 'z', targetName: 'n' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not render the "go to connect" button when onGoToStep is not provided', () => {
    renderStep({ onGoToStep: undefined })
    // Banner still shows (informational), but no navigation button
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect|ligar|validar/i })).not.toBeInTheDocument()
  })
})
