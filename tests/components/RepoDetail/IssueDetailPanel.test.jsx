import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IssueDetailPanel } from '@/components/RepoDetail/IssueDetailPanel'
import { renderWithProviders } from '../../helpers/render-with-providers'

// ReactMarkdown pulls in remark/unified which is noisy in unit tests; stubbing
// keeps the render focused on the behaviour we care about (toast feedback).
vi.mock('react-markdown', () => ({
    default: ({ children }) => <div>{children}</div>
}))

const sampleIssue = {
    id: 1,
    number: 10,
    title: 'A real bug',
    body: 'body text',
    state: 'open',
    user: { login: 'octocat' },
    labels: [],
    created_at: '2026-04-10T00:00:00Z',
    comments: 0,
    html_url: 'https://github.com/owner/repo/issues/10'
}

function makeApi(overrides = {}) {
    return {
        fetchIssue: vi.fn().mockResolvedValue(sampleIssue),
        fetchIssueComments: vi.fn().mockResolvedValue([]),
        commentOnIssue: vi.fn().mockResolvedValue({}),
        updateIssue: vi.fn().mockResolvedValue({}),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('IssueDetailPanel — toast feedback', () => {
    it('fires a success toast when a comment is submitted', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <IssueDetailPanel
                issue={sampleIssue}
                api={api}
                onClose={vi.fn()}
                onUpdate={vi.fn()}
                repoFullName="owner/repo"
            />
        )

        // Wait for the detail fetch to resolve so the comment textarea mounts.
        const textarea = await screen.findByLabelText(/Issue comment/i)
        await user.type(textarea, 'Hello from the test')
        await user.click(screen.getByRole('button', { name: /^Comment$/i }))

        await waitFor(() =>
            expect(api.commentOnIssue).toHaveBeenCalledWith(10, 'Hello from the test')
        )
        expect(await screen.findByText('Comment posted')).toBeInTheDocument()
    })
})
