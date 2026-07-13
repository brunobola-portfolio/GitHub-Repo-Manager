import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../helpers/render-with-providers'

// ReactMarkdown is noisy in unit tests — stub to a pass-through div.
vi.mock('react-markdown', () => ({
    default: ({ children }) => <div>{children}</div>
}))

// ConfirmModal uses a focus trap backed by real DOM APIs we don't need here.
vi.mock('@/hooks/useFocusTrap', () => ({
    useFocusTrap: () => ({ current: null })
}))

// useAIStatus is mocked so each test controls the configured/loading flags.
vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn(() => ({ configured: true, loading: false })) }))
import { useAIStatus } from '@/hooks/useAIStatus'

const { PRDetailPanel } = await import('@/components/RepoDetail/PRDetailPanel')

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

describe('PRDetailPanel — Generate Description gate', () => {
    it('renders the Generate Description button enabled when AI is configured', async () => {
        useAIStatus.mockReturnValue({ configured: true, loading: false })
        renderWithProviders(
            <PRDetailPanel
                pr={samplePr}
                api={makeApi()}
                onClose={vi.fn()}
                onUpdate={vi.fn()}
                onGenerateDescription={vi.fn()}
            />,
        )
        const btn = await screen.findByRole('button', { name: /generate description/i })
        expect(btn).toBeEnabled()
    })

    it('disables the button with a tooltip when AI is off', async () => {
        useAIStatus.mockReturnValue({ configured: false, loading: false })
        renderWithProviders(
            <PRDetailPanel
                pr={samplePr}
                api={makeApi()}
                onClose={vi.fn()}
                onUpdate={vi.fn()}
                onGenerateDescription={vi.fn()}
            />,
        )
        const btn = await screen.findByRole('button', { name: /generate description/i })
        expect(btn).toBeDisabled()
        expect(btn).toHaveAttribute('title', expect.stringContaining('Settings'))
    })
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

        // Merging is confirm-gated (Task 1 audit fix) — clicking Merge opens the
        // dialog first; the API call only happens once the user confirms.
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Merge$/i }))

        await waitFor(() =>
            expect(api.mergePull).toHaveBeenCalledWith(42, { merge_method: 'merge' })
        )
        expect(await screen.findByText('Merged')).toBeInTheDocument()
    })
})

describe('PRDetailPanel — merge/close are confirm-gated', () => {
    it('clicking Merge opens a confirm modal and does not call api.mergePull yet', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /^Merge$/i }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText(/Merge PR #42/)).toBeInTheDocument()
        expect(api.mergePull).not.toHaveBeenCalled()
    })

    it('clicking Squash and merge opens a confirm modal and does not call api.mergePull yet', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /^Squash$/i }))
        await user.click(await screen.findByRole('button', { name: /squash and merge/i }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText(/Merge PR #42/)).toBeInTheDocument()
        expect(api.mergePull).not.toHaveBeenCalled()
    })

    it('confirming the merge dialog calls api.mergePull with the chosen method', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /^Squash$/i }))
        await user.click(await screen.findByRole('button', { name: /squash and merge/i }))

        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Merge$/i }))

        await waitFor(() =>
            expect(api.mergePull).toHaveBeenCalledWith(42, { merge_method: 'squash' })
        )
    })

    it('cancelling the merge dialog never calls api.mergePull', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /^Merge$/i }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(api.mergePull).not.toHaveBeenCalled()
    })

    it('clicking Close PR opens a confirm modal and does not call api.updatePull yet', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /close pr/i }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText(/Close PR #42/)).toBeInTheDocument()
        expect(api.updatePull).not.toHaveBeenCalled()
    })

    it('confirming the close dialog calls api.updatePull with state closed', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /close pr/i }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Close PR$/i }))

        await waitFor(() =>
            expect(api.updatePull).toHaveBeenCalledWith(42, { state: 'closed' })
        )
    })

    it('cancelling the close dialog never calls api.updatePull', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(
            <PRDetailPanel pr={samplePr} api={api} onClose={vi.fn()} onUpdate={vi.fn()} />
        )

        await user.click(await screen.findByRole('button', { name: /close pr/i }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(api.updatePull).not.toHaveBeenCalled()
    })
})
