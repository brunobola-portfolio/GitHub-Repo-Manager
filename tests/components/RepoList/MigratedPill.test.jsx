/*
 * MigratedPill — now reads from the shared useMigratedRepos batch instead of
 * one fetch per card. This locks the fix for the N+1 (audit #5): a grid of
 * pills makes a single /api/migration/marks/mine request, and the pill renders
 * only for repos that are actually migrated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MigratedPill } from '@/components/RepoList/MigratedPill'
import { invalidateMigratedRepos } from '@/hooks/useMigratedRepos'

vi.mock('@/config', () => ({ MOCK_MODE: false }))

beforeEach(() => invalidateMigratedRepos())
afterEach(() => { vi.restoreAllMocks(); invalidateMigratedRepos() })

describe('MigratedPill — batched via useMigratedRepos', () => {
  it('makes ONE request for many pills and renders only for migrated repos', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ migrated: { 'owner/a': { writtenAt: '2026-05-23T10:00:00Z' } } }),
    })

    render(
      <div>
        <MigratedPill fullName="owner/a" />
        <MigratedPill fullName="owner/b" />
        <MigratedPill fullName="owner/c" />
      </div>,
    )

    await waitFor(() => expect(screen.getByLabelText('repo migrated')).toBeInTheDocument())

    // The whole grid shares a single round-trip (was one-per-card before).
    const mineCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/migration/marks/mine'))
    expect(mineCalls.length).toBe(1)

    // Only owner/a is migrated → exactly one pill, with the tooltip date.
    expect(screen.getAllByLabelText('repo migrated')).toHaveLength(1)
    expect(screen.getByTitle('Migrated on 2026-05-23')).toBeInTheDocument()
  })

  it('renders nothing when the user has no migrated repos', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ migrated: {} }) })
    render(<MigratedPill fullName="owner/a" />)
    // Give the shared fetch a tick to resolve, then assert no pill.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByLabelText('repo migrated')).toBeNull()
  })
})
