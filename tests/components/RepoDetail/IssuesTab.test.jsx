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
        expect(await screen.findByText('Issue closed')).toBeInTheDocument()
    })
})
