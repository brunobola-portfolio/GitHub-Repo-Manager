import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// MOCK_MODE + framer-motion: motion.button / motion.div should render as plain
// <button>/<div> so whileHover/whileTap/etc don't choke happy-dom.
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

// ---------------------------------------------------------------------------
// QuickActionButtons dispatches through runAction + the repoActions registry
// (the same DI hook RepoList uses) so bulk actions get real confirmation and
// honest result toasts. Stub the context rather than booting useGitHub.
// ---------------------------------------------------------------------------
const confirmGate = vi.fn(async () => true)
const performAction = vi.fn(async () => ({ success: true }))
const deleteRepos = vi.fn(async () => ({ success: true }))
const archiveRepos = vi.fn(async () => ({ success: true }))
const openModalWithData = vi.fn()
const toastStub = { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() }

vi.mock('@/actions/repoActionContext', () => ({
    useRepoActionContext: () => ({
        api: {},
        toast: toastStub,
        openModal: vi.fn(),
        openModalWithData,
        closeModal: vi.fn(),
        refresh: vi.fn(),
        performAction,
        archiveRepos,
        deleteRepos,
        confirmGate,
    }),
}))

// ---------------------------------------------------------------------------
// Import after mocks. SlimSidebar lives in its own module (lazy-loaded from
// App.jsx) so its rail-exclusive code stays out of the eager entry chunk;
// Sidebar remains in Sidebar.jsx and exports the shared sub-components
// (QuickActionButtons/ActionHistoryRow/ActivityRow) SlimSidebar imports.
// ---------------------------------------------------------------------------
const { Sidebar, QuickActionButtons } = await import('@/components/Sidebar')
const { SlimSidebar } = await import('@/components/SlimSidebar')
const { SelectionProvider } = await import('@/contexts/SelectionContext')
const { ModalProvider } = await import('@/contexts/ModalContext')

function renderSlim(props = {}) {
    return render(
        <SelectionProvider>
            <ModalProvider>
                <SlimSidebar
                    selectedRepos={[]}
                    onOpenImport={vi.fn()}
                    onNavigateWorkBoard={vi.fn()}
                    {...props}
                />
            </ModalProvider>
        </SelectionProvider>
    )
}

function renderFull(props = {}) {
    return render(
        <SelectionProvider>
            <ModalProvider>
                <Sidebar
                    isPerforming={false}
                    message=""
                    results={[]}
                    selectedRepos={[]}
                    activity={[]}
                    {...props}
                />
            </ModalProvider>
        </SelectionProvider>
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('SlimSidebar', () => {
    it('renders icon buttons by default (slim mode)', () => {
        renderSlim()
        // Quick Actions, Action History, Recent Activity, Import Repository
        expect(screen.getByRole('button', { name: /quick actions/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /action history/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /recent activity/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /import repository/i })).toBeInTheDocument()
    })

    it('every slim icon button exposes an aria-label with the section name', () => {
        renderSlim()
        // Work Board shows up when onNavigateWorkBoard is passed.
        const expectedLabels = [
            /work board/i,
            /quick actions/i,
            /action history/i,
            /recent activity/i,
            /import repository/i,
        ]
        for (const label of expectedLabels) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
        }
    })

    it('clicking the Work Board icon fires onNavigateWorkBoard', () => {
        const onNavigateWorkBoard = vi.fn()
        renderSlim({ onNavigateWorkBoard })
        fireEvent.click(screen.getByRole('button', { name: /work board/i }))
        expect(onNavigateWorkBoard).toHaveBeenCalledTimes(1)
    })

    it('clicking Import Repository fires onOpenImport', () => {
        const onOpenImport = vi.fn()
        renderSlim({ onOpenImport })
        fireEvent.click(screen.getByRole('button', { name: /import repository/i }))
        expect(onOpenImport).toHaveBeenCalledTimes(1)
    })
})

describe('Sidebar (expanded)', () => {
    it('renders Quick Actions, Action History, and Recent Activity sections', () => {
        renderFull()
        // Panel headings
        expect(screen.getByRole('heading', { name: /quick actions/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /action history/i })).toBeInTheDocument()
        // "No recent activity found" is the empty-state for the activity panel.
        expect(screen.getByText(/no recent activity found/i)).toBeInTheDocument()
    })
})

describe('Quick Actions dispatch through the action registry', () => {
    const repos = [
        { id: 1, full_name: 'acme/api', name: 'api', owner: { login: 'acme' } },
        { id: 2, full_name: 'acme/web', name: 'web', owner: { login: 'acme' } },
    ]

    // Rendered directly: the surrounding QuickActions card gates on the
    // selection CONTEXT, while the action grid operates on the repo objects.
    function renderGrid(selectedRepos = repos) {
        return render(
            <SelectionProvider>
                <ModalProvider>
                    <QuickActionButtons isPerforming={false} selectedRepos={selectedRepos} />
                </ModalProvider>
            </SelectionProvider>
        )
    }

    it('Delete asks for confirmation before touching the bulk endpoint', async () => {
        renderGrid()
        fireEvent.click(screen.getByRole('button', { name: /delete/i }))
        await vi.waitFor(() => expect(confirmGate).toHaveBeenCalledTimes(1))
        // Type-to-confirm is what makes an accidental multi-repo delete hard.
        expect(confirmGate.mock.calls[0][0]).toMatchObject({
            variant: 'danger',
            requiresInput: 'delete 2 repos',
        })
        await vi.waitFor(() => expect(deleteRepos).toHaveBeenCalledWith(['acme/api', 'acme/web']))
    })

    it('Private sends the real selection instead of reporting a phantom success', async () => {
        renderGrid()
        fireEvent.click(screen.getByRole('button', { name: /private/i }))
        await vi.waitFor(() => expect(performAction).toHaveBeenCalledTimes(1))
        expect(performAction).toHaveBeenCalledWith(
            'visibility', ['acme/api', 'acme/web'], '', { makePublic: false }
        )
        expect(toastStub.success).toHaveBeenCalledWith('2 repositories are now private')
    })

    it('disables every action and explains why when nothing is selected', () => {
        renderGrid([])
        expect(screen.getByText(/select one or more repositories/i)).toBeInTheDocument()
        for (const name of [/private/i, /public/i, /transfer/i, /archive/i, /delete/i]) {
            expect(screen.getByRole('button', { name })).toBeDisabled()
        }
        expect(deleteRepos).not.toHaveBeenCalled()
        expect(performAction).not.toHaveBeenCalled()
    })
})
