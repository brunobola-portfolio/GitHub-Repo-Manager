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
// Import after mocks. Both Sidebar and SlimSidebar are exported from the
// same module.
// ---------------------------------------------------------------------------
const { Sidebar, SlimSidebar } = await import('@/components/Sidebar')
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
                    performAction={vi.fn()}
                    message=""
                    results={[]}
                    onArchive={vi.fn()}
                    onDelete={vi.fn()}
                    selectedRepos={[]}
                    onTransfer={vi.fn()}
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
