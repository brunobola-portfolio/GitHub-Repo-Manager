import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// ---------------------------------------------------------------------------
// MOCK_MODE + framer-motion: motion.* render as plain elements so
// whileHover/whileTap/etc don't choke happy-dom.
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
}))

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
    }
})

const { SlimSidebar } = await import('@/components/SlimSidebar')
const { SelectionProvider } = await import('@/contexts/SelectionContext')
const { ModalProvider } = await import('@/contexts/ModalContext')

const sampleResults = [
    { action: 'delete', success: true, at: Date.now(), message: 'Deleted repo-a' },
    {
        action: 'archive',
        success: false,
        at: Date.now(),
        message: 'Failed to archive repo-b',
        details: [{ message: 'Permission denied' }],
    },
]

const sampleActivity = [
    {
        id: 'e1',
        type: 'PushEvent',
        created_at: new Date().toISOString(),
        repo: { name: 'octocat/hello' },
        payload: { size: 2, ref: 'refs/heads/main' },
    },
    {
        id: 'e2',
        type: 'PullRequestEvent',
        created_at: new Date().toISOString(),
        repo: { name: 'octocat/world' },
        payload: { action: 'opened', number: 7, pull_request: { title: 'Add feature' } },
    },
]

const sampleRepos = [
    { id: 1, name: 'repo-a' },
    { id: 2, name: 'repo-b' },
    { id: 3, name: 'repo-c' },
]

function renderSlim(props = {}) {
    return render(
        <SelectionProvider>
            <ModalProvider>
                <SlimSidebar
                    selectedRepos={[]}
                    results={[]}
                    activity={[]}
                    onOpenImport={vi.fn()}
                    onNavigateWorkBoard={vi.fn()}
                    {...props}
                />
            </ModalProvider>
        </SelectionProvider>
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('SlimSidebar — popover aria-modal', () => {
    it('marks the popover aria-modal="false" — the page stays interactive while it is open', () => {
        renderSlim()
        fireEvent.click(screen.getByRole('button', { name: /action history/i }))
        const dialog = screen.getByRole('dialog', { name: /action history/i })
        expect(dialog).toHaveAttribute('aria-modal', 'false')
    })
})

describe('SlimSidebar — real data in popovers', () => {
    it('Action History popover renders real result rows', () => {
        renderSlim({ results: sampleResults })
        fireEvent.click(screen.getByRole('button', { name: /action history/i }))
        const dialog = screen.getByRole('dialog', { name: /action history/i })
        expect(within(dialog).getByText('Delete')).toBeInTheDocument()
        expect(within(dialog).getByText('Deleted repo-a')).toBeInTheDocument()
        expect(within(dialog).getByText('Failed to archive repo-b')).toBeInTheDocument()
    })

    it('Action History popover shows honest empty when there are no results', () => {
        renderSlim({ results: [] })
        fireEvent.click(screen.getByRole('button', { name: /action history/i }))
        const dialog = screen.getByRole('dialog', { name: /action history/i })
        expect(within(dialog).getByText(/no recent actions/i)).toBeInTheDocument()
    })

    it('Recent Activity popover renders real activity rows', () => {
        renderSlim({ activity: sampleActivity })
        fireEvent.click(screen.getByRole('button', { name: /recent activity/i }))
        const dialog = screen.getByRole('dialog', { name: /recent activity/i })
        expect(within(dialog).getByText('octocat/hello')).toBeInTheDocument()
        expect(within(dialog).getByText('octocat/world')).toBeInTheDocument()
    })

    it('Recent Activity popover shows honest empty when there is no activity', () => {
        renderSlim({ activity: [] })
        fireEvent.click(screen.getByRole('button', { name: /recent activity/i }))
        const dialog = screen.getByRole('dialog', { name: /recent activity/i })
        expect(within(dialog).getByText(/no recent activity/i)).toBeInTheDocument()
    })

    it('Quick Actions popover reflects selection count and renders real actions', () => {
        renderSlim({
            selectedRepos: sampleRepos,
            performAction: vi.fn(),
            onArchive: vi.fn(),
            onDelete: vi.fn(),
            onTransfer: vi.fn(),
        })
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        const dialog = screen.getByRole('dialog', { name: /quick actions/i })
        expect(within(dialog).getByText(/3 selected/i)).toBeInTheDocument()
        // Real quick actions (reused from the expanded Sidebar), not placeholder text.
        expect(within(dialog).getByRole('button', { name: /delete/i })).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: /archive/i })).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: /transfer/i })).toBeInTheDocument()
    })

    it('clicking a slim quick action fires the real handler', () => {
        const onDelete = vi.fn()
        renderSlim({ selectedRepos: sampleRepos, onDelete })
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        const dialog = screen.getByRole('dialog', { name: /quick actions/i })
        fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
        expect(onDelete).toHaveBeenCalledWith(sampleRepos)
    })

    it('Quick Actions popover shows honest empty when nothing is selected', () => {
        renderSlim({ selectedRepos: [] })
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        const dialog = screen.getByRole('dialog', { name: /quick actions/i })
        expect(within(dialog).getByText(/select repos/i)).toBeInTheDocument()
    })
})

describe('SlimSidebar — count badges', () => {
    it('shows a count badge on the History icon when results exist', () => {
        renderSlim({ results: sampleResults })
        const btn = screen.getByRole('button', { name: /action history/i })
        expect(within(btn).getByText('2')).toBeInTheDocument()
    })

    it('does not show a count badge on the History icon when empty', () => {
        renderSlim({ results: [] })
        const btn = screen.getByRole('button', { name: /action history/i })
        expect(within(btn).queryByText(/^\d+$/)).not.toBeInTheDocument()
    })

    it('shows a count badge on the Activity icon when events exist', () => {
        renderSlim({ activity: sampleActivity })
        const btn = screen.getByRole('button', { name: /recent activity/i })
        expect(within(btn).getByText('2')).toBeInTheDocument()
    })

    it('shows a count badge on the Quick Actions icon when repos are selected', () => {
        renderSlim({ selectedRepos: sampleRepos })
        const btn = screen.getByRole('button', { name: /quick actions/i })
        expect(within(btn).getByText('3')).toBeInTheDocument()
    })

    it('does not show a count badge on the Quick Actions icon with no selection', () => {
        renderSlim({ selectedRepos: [] })
        const btn = screen.getByRole('button', { name: /quick actions/i })
        expect(within(btn).queryByText(/^\d+$/)).not.toBeInTheDocument()
    })
})
