import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRDetailPanel } from '@/components/RepoDetail/PRDetailPanel'
import { renderWithProviders } from '../../helpers/render-with-providers'

// ReactMarkdown is noisy in unit tests — stub to a pass-through div.
vi.mock('react-markdown', () => ({
    default: ({ children }) => <div>{children}</div>
}))

const samplePr = {
    id: 1,
    number: 42,
    title: 'Fix the thing',
    body: 'body text',
    state: 'open',
    user: { login: 'octocat' },
    head: { ref: 'feature' },
    base: { ref: 'main' },
    created_at: '2026-04-10T00:00:00Z',
    html_url: 'https://github.com/owner/repo/pull/42'
}

function makeApi(overrides = {}) {
    return {
        fetchPull: vi.fn().mockResolvedValue(samplePr),
        fetchPullReviews: vi.fn().mockResolvedValue([]),
        fetchPullFiles: vi.fn().mockResolvedValue([]),
        fetchIssueComments: vi.fn().mockResolvedValue([]),
        commentOnIssue: vi.fn().mockResolvedValue({}),
        mergePull: vi.fn().mockResolvedValue({ merged: true }),
        updatePull: vi.fn().mockResolvedValue({}),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('PRDetailPanel — toast feedback', () => {
    it('fires a success toast when a PR is merged', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel
                pr={samplePr}
                api={api}
                onClose={vi.fn()}
                onUpdate={vi.fn()}
            />
        )

        // The merge button label reflects the default method ("Merge commit" → label "Merge").
        const mergeButton = await screen.findByRole('button', { name: /^Merge$/i })
        await user.click(mergeButton)

        await waitFor(() =>
            expect(api.mergePull).toHaveBeenCalledWith(42, { merge_method: 'merge' })
        )
        expect(await screen.findByText('Merged')).toBeInTheDocument()
    })
})
