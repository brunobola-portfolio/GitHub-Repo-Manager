import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullRequestsTab } from '@/components/RepoDetail/PullRequestsTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

// ConfirmModal uses a focus trap backed by real DOM APIs we don't need here.
vi.mock('@/hooks/useFocusTrap', () => ({
    useFocusTrap: () => ({ current: null })
}))

const samplePulls = [
    {
        id: 1,
        number: 42,
        title: 'Fix the thing',
        state: 'open',
        user: { login: 'octocat' },
        head: { ref: 'feature' },
        base: { ref: 'main' },
        created_at: '2026-04-10T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/42'
    }
]

function makeApi(overrides = {}) {
    return {
        fetchPulls: vi.fn().mockResolvedValue({ data: samplePulls }),
        createPull: vi.fn().mockResolvedValue({ number: 43 }),
        mergePull: vi.fn().mockResolvedValue({ merged: true }),
        updatePull: vi.fn().mockResolvedValue({}),
        fetchBranches: vi.fn().mockResolvedValue({ data: [] }),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('PullRequestsTab — accessible row structure', () => {
    it('opens via a real title button, not a role="button" row wrapper', async () => {
        const api = makeApi()
        renderWithProviders(
            <PullRequestsTab api={api} onStartReview={vi.fn()} onGenerateDescription={vi.fn()} />
        )

        // The row's primary control is now a real <button> carrying the stable
        // "Open pull request #N: <title>" name (e2e + SR selector), instead of a
        // div[role=button] wrapping the inner Merge/Close/View controls.
        const opener = await screen.findByRole('button', { name: /Open pull request #42: Fix the thing/i })
        expect(opener.tagName).toBe('BUTTON')

        // The surrounding row Card must NOT expose an interactive role or be a
        // tab stop — that nested-interactive shape is exactly what axe flagged.
        const rowCard = opener.closest('.cursor-pointer')
        expect(rowCard).not.toBeNull()
        expect(rowCard).not.toHaveAttribute('role')
        expect(rowCard).not.toHaveAttribute('tabindex')
    })

    it('clicking the title button opens the PR detail panel', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PullRequestsTab api={api} onStartReview={vi.fn()} onGenerateDescription={vi.fn()} />
        )

        const opener = await screen.findByRole('button', { name: /Open pull request #42: Fix the thing/i })
        await user.click(opener)

        // Navigating to the detail panel unmounts the list, so the row opener is gone.
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: /Open pull request #42/i })).not.toBeInTheDocument()
        )
    })
})

describe('PullRequestsTab — toast feedback', () => {
    it('fires a success toast when a PR is merged', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PullRequestsTab api={api} onStartReview={vi.fn()} onGenerateDescription={vi.fn()} />
        )

        await waitFor(() =>
            expect(screen.getByText('Fix the thing')).toBeInTheDocument()
        )

        await user.click(screen.getByRole('button', { name: /Merge/i }))

        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Merge$/i }))

        await waitFor(() =>
            expect(api.mergePull).toHaveBeenCalledWith(42)
        )
        // Toast text shape now comes from prActions.merge_pr.run() — "Merged PR #42".
        expect(await screen.findByText(/Merged PR #42/)).toBeInTheDocument()
    })
})
