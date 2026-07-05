import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IssuesTab } from '@/components/RepoDetail/IssuesTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

const sampleIssues = [
    {
        id: 1,
        number: 10,
        title: 'A real bug',
        body: '',
        state: 'open',
        user: { login: 'octocat' },
        labels: [],
        created_at: '2026-04-10T00:00:00Z',
        comments: 0,
        html_url: 'https://github.com/owner/repo/issues/10'
    }
]

function makeApi(overrides = {}) {
    return {
        fetchIssues: vi.fn().mockResolvedValue({ data: sampleIssues }),
        createIssue: vi.fn().mockResolvedValue({ number: 11 }),
        updateIssue: vi.fn().mockResolvedValue({}),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('IssuesTab — accessible row structure', () => {
    it('opens via a real title button, not a role="button" row wrapper', async () => {
        const api = makeApi()
        renderWithProviders(<IssuesTab api={api} repoFullName="owner/repo" />)

        // The row's primary control is now a real <button> carrying the stable
        // "Open issue #N: <title>" name, instead of a div[role=button] wrapping
        // the inner Close/View controls (the nested-interactive axe violation).
        const opener = await screen.findByRole('button', { name: /Open issue #10: A real bug/i })
        expect(opener.tagName).toBe('BUTTON')

        const rowCard = opener.closest('.cursor-pointer')
        expect(rowCard).not.toBeNull()
        expect(rowCard).not.toHaveAttribute('role')
        expect(rowCard).not.toHaveAttribute('tabindex')
    })

    it('clicking the title button opens the issue detail panel', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(<IssuesTab api={api} repoFullName="owner/repo" />)

        const opener = await screen.findByRole('button', { name: /Open issue #10: A real bug/i })
        await user.click(opener)

        // Navigating to the detail panel unmounts the list, so the row opener is gone.
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: /Open issue #10/i })).not.toBeInTheDocument()
        )
    })
})

describe('IssuesTab — toast feedback', () => {
    it('fires a success toast when an issue is closed', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(<IssuesTab api={api} repoFullName="owner/repo" />)

        await waitFor(() =>
            expect(screen.getByText('A real bug')).toBeInTheDocument()
        )

        await user.click(screen.getByRole('button', { name: /^Close$/i }))

        await waitFor(() =>
            expect(api.updateIssue).toHaveBeenCalledWith(10, { state: 'closed' })
        )
        // Toast text now comes from issueActions.close_issue.run() — "Closed issue #10".
        expect(await screen.findByText(/Closed issue #10/)).toBeInTheDocument()
    })
})
