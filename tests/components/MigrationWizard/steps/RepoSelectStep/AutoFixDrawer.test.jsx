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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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

  it('selecting lfs-migrate also enables lfsEnabled in the patch', async () => {
    const user = userEvent.setup({ delay: null })
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
    await user.click(screen.getByRole('button', { name: /Mark for LFS migration/i }))
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { sizeStrategy: 'lfs-migrate', lfsEnabled: true } },
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

  it('edit to a conflicting name excludes the item from Apply', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ duplicates: { 'existing-name': true } }),
    })
    const user = userEvent.setup({ delay: null })
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
    const input = screen.getByRole('textbox', { name: /Rename target for api/i })
    await user.clear(input)
    await user.type(input, 'existing-name')
    await screen.findByDisplayValue('existing-name')
    // Re-request /check-duplicates should mark conflict; the applySet excludes it.
    // Await the apply button showing (0) — it may take a moment as the hook re-evaluates.
    expect(await screen.findByRole('button', { name: /Apply selected \(0\)/i })).toBeDisabled()
  })

  it('edit to an invalid name excludes the item from Apply', async () => {
    const user = userEvent.setup({ delay: null })
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
    const input = screen.getByRole('textbox', { name: /Rename target for api/i })
    await user.clear(input)
    await user.type(input, 'bad name!')
    await screen.findByDisplayValue('bad name!')
    expect(screen.getByRole('button', { name: /Apply selected \(0\)/i })).toBeDisabled()
  })

  it('pre-selects the strategy when repo.sizeStrategy is already set', () => {
    const repos = [
      makeRepo({
        id: 'b',
        name: 'huge',
        size: 11 * 1024 * 1024,
        selected: true,
        sizeStrategy: 'lfs-migrate',
      }),
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
    expect(
      screen.getByRole('button', { name: /Mark for LFS migration/i }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a "Fix applied" badge when repo.sizeStrategy is already set', () => {
    const repos = [
      makeRepo({
        id: 'b',
        name: 'huge',
        size: 11 * 1024 * 1024,
        selected: true,
        sizeStrategy: 'lfs-migrate',
      }),
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
    expect(screen.getByText(/Fix applied/i)).toBeInTheDocument()
  })

  it('Apply count excludes already-applied strategies', () => {
    const repos = [
      makeRepo({
        id: 'b',
        name: 'huge',
        size: 11 * 1024 * 1024,
        selected: true,
        sizeStrategy: 'lfs-migrate',
      }),
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
    expect(
      screen.getByRole('button', { name: /Apply selected \(0\)/i }),
    ).toBeDisabled()
  })

  it('changing the pre-applied strategy enables Apply with the new value', async () => {
    const user = userEvent.setup({ delay: null })
    const onApply = vi.fn()
    const repos = [
      makeRepo({
        id: 'b',
        name: 'huge',
        size: 11 * 1024 * 1024,
        selected: true,
        sizeStrategy: 'lfs-migrate',
      }),
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
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Exclude from migration/i }))
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { sizeStrategy: 'exclude' } },
    ])
  })

  it('reopening resets edits, checks, and strategies', async () => {
    const user = userEvent.setup({ delay: null })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { rerender } = render(
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
    const input = screen.getByRole('textbox', { name: /Rename target for api/i })
    await user.clear(input)
    await user.type(input, 'edited-name')
    // findBy* polls — happy-dom + userEvent.type can race the last keystroke
    // against the assertion if we read synchronously.
    await screen.findByDisplayValue('edited-name')
    // Close drawer
    rerender(
      <AutoFixDrawer
        open={false}
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    // Reopen
    rerender(
      <AutoFixDrawer
        open={true}
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    // Edit should be gone — fresh plan suggestion again
    expect(screen.getByDisplayValue('api-repo')).toBeInTheDocument()
  })
})
