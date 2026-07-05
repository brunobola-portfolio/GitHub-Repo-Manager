/*
 * Unsaved-changes guard for the Settings tab (prod-premium readiness — UX medium).
 *
 * RepoDetail unmounts the Settings tab on tab switch / Back; SettingsTab tracks a
 * dirty bit but nothing used to guard the switch, silently destroying edits. These
 * tests drive the guard: switching away from a dirty Settings tab shows the
 * standard confirm; Discard proceeds; Stay keeps the tab mounted.
 *
 * SettingsTab / OverviewTab / TrackedChip and useRepoDetail are stubbed so the
 * test exercises RepoDetail's guard logic in isolation (SettingsTab's own dirty
 * computation is covered elsewhere).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const { REPO, apiStub } = vi.hoisted(() => {
    const REPO = {
        id: 1,
        name: 'app',
        full_name: 'me/app',
        owner: { login: 'me' },
        private: false,
        topics: [],
        html_url: 'https://github.com/me/app',
    }
    // Stable reference so useRepoDetail() doesn't change identity across renders
    // (which would re-fire RepoDetail's load effect in a loop).
    return { REPO, apiStub: { fetchRepo: () => Promise.resolve({ data: REPO }) } }
})

vi.mock('@/hooks/useRepoDetail', () => ({ useRepoDetail: () => apiStub }))

vi.mock('@/components/WorkBoard/TrackedChip', () => ({
    TrackedChip: () => null,
}))

vi.mock('@/components/RepoDetail/OverviewTab', () => ({
    OverviewTab: () => <div data-testid="overview-stub">overview</div>,
}))

vi.mock('@/components/RepoDetail/SettingsTab', () => ({
    SettingsTab: ({ onDirtyChange }) => (
        <div data-testid="settings-stub">
            <button type="button" onClick={() => onDirtyChange(true)}>Make dirty</button>
        </div>
    ),
}))

const { RepoDetail } = await import('@/components/RepoDetail/RepoDetail')

async function renderOnSettings() {
    const onBack = vi.fn()
    render(<RepoDetail repo={REPO} onBack={onBack} initialTab="settings" />)
    // Wait for the lazy Settings tab (+ initial repo load) to resolve.
    await screen.findByTestId('settings-stub')
    return { onBack }
}

describe('RepoDetail — unsaved Settings guard', () => {
    afterEach(cleanup)

    it('switching tabs from a clean Settings tab does NOT prompt', async () => {
        await renderOnSettings()
        fireEvent.click(screen.getByRole('tab', { name: /Overview/i }))
        expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
        expect(await screen.findByTestId('overview-stub')).toBeInTheDocument()
    })

    it('switching tabs with dirty settings shows the confirm', async () => {
        await renderOnSettings()
        fireEvent.click(screen.getByRole('button', { name: /make dirty/i }))
        fireEvent.click(screen.getByRole('tab', { name: /Overview/i }))
        expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
        // Still on Settings — the switch is held pending the decision.
        expect(screen.getByTestId('settings-stub')).toBeInTheDocument()
        expect(screen.queryByTestId('overview-stub')).not.toBeInTheDocument()
    })

    it('Stay keeps the Settings tab mounted', async () => {
        await renderOnSettings()
        fireEvent.click(screen.getByRole('button', { name: /make dirty/i }))
        fireEvent.click(screen.getByRole('tab', { name: /Overview/i }))
        fireEvent.click(screen.getByRole('button', { name: /stay/i }))
        expect(screen.getByTestId('settings-stub')).toBeInTheDocument()
        expect(screen.queryByTestId('overview-stub')).not.toBeInTheDocument()
    })

    it('Discard proceeds to the requested tab', async () => {
        await renderOnSettings()
        fireEvent.click(screen.getByRole('button', { name: /make dirty/i }))
        fireEvent.click(screen.getByRole('tab', { name: /Overview/i }))
        fireEvent.click(screen.getByRole('button', { name: /discard/i }))
        expect(await screen.findByTestId('overview-stub')).toBeInTheDocument()
        expect(screen.queryByTestId('settings-stub')).not.toBeInTheDocument()
    })

    it('Back from a dirty Settings tab prompts, and Discard calls onBack', async () => {
        const { onBack } = await renderOnSettings()
        fireEvent.click(screen.getByRole('button', { name: /make dirty/i }))
        fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
        expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
        expect(onBack).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /discard/i }))
        expect(onBack).toHaveBeenCalledTimes(1)
    })
})
