// tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoFixDrawer } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx'
import { makeRepo } from './fixtures.js'

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ duplicates: {} }),
  })
})
afterEach(() => vi.resetAllMocks())

describe('AutoFixDrawer', () => {
  it('renders deterministic items in Renames section', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok-name', selected: true }),
    ]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByText(/Renames/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('api-repo')).toBeInTheDocument()
  })

  it('Apply selected is disabled when nothing is checked', async () => {
    const user = userEvent.setup()
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Apply fix for api/i })
    await user.click(checkbox)
    const btn = screen.getByRole('button', { name: /Apply selected \(0\)/i })
    expect(btn).toBeDisabled()
  })

  it('calls onApply with the expected payload', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { targetName: 'api-repo', conflictAction: 'rename' } },
    ])
  })

  it('size-critical card without chosen strategy is not counted', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'ok', size: 1024, selected: true }),
      makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true }),
    ]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Apply selected \(0\)/i })).toBeDisabled()
  })

  it('selecting a strategy enables Apply for that repo', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const repos = [makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Exclude from migration/i }))
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { sizeStrategy: 'exclude' } },
    ])
  })

  it('shows AI unavailable banner when aiAvailable is false and size-critical exists', () => {
    const repos = [makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByText(/AI suggestions unavailable/i)).toBeInTheDocument()
  })
})
