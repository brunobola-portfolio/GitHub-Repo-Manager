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
