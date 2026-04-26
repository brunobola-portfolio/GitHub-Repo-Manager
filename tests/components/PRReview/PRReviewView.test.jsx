import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// -----------------------------------------------------------------------
// Config / MOCK_MODE stub — avoid hitting the real API client.
// -----------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
}))

// -----------------------------------------------------------------------
// framer-motion stub — render children synchronously, drop animation props.
// -----------------------------------------------------------------------
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        const {
            initial, animate, exit, variants, transition, layout, layoutId,
            whileHover, whileTap, whileFocus, whileInView, viewport,
            drag, dragConstraints, dragElastic,
            ...clean
        } = rest
        return React.createElement('div', clean, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
        useReducedMotion: () => false,
    }
})

// -----------------------------------------------------------------------
// Heavy PR review dependencies — mocked to isolate the staleness flow.
// -----------------------------------------------------------------------
vi.mock('@/hooks/useRepoDetail', () => ({
    useRepoDetail: () => ({
        fetchIssue: vi.fn(),
        fetchIssueComments: vi.fn(),
        updateIssue: vi.fn(),
    }),
}))

const mockCheckStaleness = vi.fn()
const mockSubmitReview = vi.fn()
const mockReplyToComment = vi.fn()

vi.mock('@/components/PRReview/hooks/useReviewData', () => ({
    useReviewData: () => ({
        loading: false,
        error: null,
        data: {
            pr: { number: 1, title: 'Test PR', user: { login: 'alice' } },
            headSha: 'abc123',
            files: [{ filename: 'src/x.js' }],
            comments: [],
        },
        refetch: vi.fn(),
        checkStaleness: mockCheckStaleness,
        submitReview: mockSubmitReview,
        replyToComment: mockReplyToComment,
    }),
}))

const mockDispatch = vi.fn()
vi.mock('@/components/PRReview/hooks/useReviewState', () => ({
    useReviewState: () => ({
        state: {
            pr: { number: 1, title: 'Test PR', user: { login: 'alice' } },
            headSha: 'abc123',
            files: [{ filename: 'src/x.js' }],
            activeFile: 'src/x.js',
            viewMode: 'unified',
            fileTreeCollapsed: false,
            comments: [],
            reviewedFiles: [],
            pendingComments: [],
            aiSummary: null,
        },
        dispatch: mockDispatch,
    }),
}))

vi.mock('@/components/PRReview/hooks/useReviewAI', () => ({
    useReviewAI: () => ({ summary: null, loading: false, error: null, retry: vi.fn() }),
    heuristicRisk: () => 0.5,
    sortFilesByRisk: (files) => files,
}))

vi.mock('@/components/PRReview/hooks/useReviewKeyboard', () => ({
    useReviewKeyboard: () => {},
}))

const mockToastError = vi.fn()
const mockToastErrorFromException = vi.fn()
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({
        toast: {
            error: mockToastError,
            success: vi.fn(),
            info: vi.fn(),
            errorFromException: mockToastErrorFromException,
        },
    }),
}))

// -----------------------------------------------------------------------
// UI primitives — stub heavy components so we can focus on the flow.
// -----------------------------------------------------------------------
vi.mock('@/components/PRReview/FileTree/FileTree', () => ({
    FileTree: () => <div data-testid="file-tree" />,
}))
vi.mock('@/components/PRReview/DiffPanel/DiffPanel', () => ({
    DiffPanel: () => <div data-testid="diff-panel" />,
}))
vi.mock('@/components/PRReview/ReviewToolbar/ReviewToolbar', () => ({
    ReviewToolbar: ({ onSubmitReview, submitting }) => (
        <div data-testid="review-toolbar">
            <button
                data-testid="submit-approve"
                onClick={() => onSubmitReview?.({ event: 'APPROVE', body: 'lgtm' })}
                disabled={submitting}
            >
                Approve
            </button>
            <span data-testid="submitting-flag">{submitting ? 'yes' : 'no'}</span>
        </div>
    ),
}))
vi.mock('@/components/PRReview/ReviewToolbar/ReviewStatusBar', () => ({
    ReviewStatusBar: () => <div data-testid="status-bar" />,
}))
vi.mock('@/components/PRReview/AIInsights/AISummaryPanel', () => ({
    AISummaryPanel: () => <div data-testid="ai-summary" />,
}))

// Real ConfirmModal — we want to test the staleness modal surface.
vi.mock('@/components/ui/ConfirmModal', async () => {
    const actual = await vi.importActual('@/components/ui/ConfirmModal')
    return actual
})

// -----------------------------------------------------------------------
// Hooks inside ConfirmModal — stub away focus-trap / scroll-lock noise.
// -----------------------------------------------------------------------
vi.mock('@/hooks/useFocusTrap', () => ({
    useFocusTrap: () => ({ current: null }),
}))
vi.mock('@/hooks/useBodyScrollLock', () => ({
    useBodyScrollLock: () => {},
}))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({
    useMobileKeyboardFix: () => {},
}))

const { PRReviewView } = await import('@/components/PRReview/PRReviewView')

function renderView(props = {}) {
    return render(
        <PRReviewView
            owner="acme"
            repo="app"
            pullNumber={1}
            repoName="acme/app"
            onBack={vi.fn()}
            {...props}
        />
    )
}

beforeEach(() => {
    mockCheckStaleness.mockReset()
    mockSubmitReview.mockReset().mockResolvedValue(undefined)
    mockDispatch.mockReset()
    mockToastError.mockReset()
    mockReplyToComment.mockReset()
})

describe('PRReviewView — staleness ConfirmModal flow', () => {
    it('submits immediately when the PR is not stale', async () => {
        mockCheckStaleness.mockResolvedValue({ isStale: false })
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })
        await waitFor(() => {
            expect(mockSubmitReview).toHaveBeenCalledTimes(1)
        })
        expect(mockSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
            event: 'APPROVE',
            body: 'lgtm',
            commitId: 'abc123',
        }))
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_PENDING_COMMENTS' })
        // No confirm modal should have appeared on the happy path.
        expect(screen.queryByText(/PR updated since you started/i)).not.toBeInTheDocument()
    })

    it('opens the ConfirmModal when the PR is stale and waits for user confirmation', async () => {
        mockCheckStaleness.mockResolvedValue({ isStale: true })
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })
        await waitFor(() => {
            expect(screen.getByText(/PR updated since you started/i)).toBeInTheDocument()
        })
        // Submit has NOT been dispatched yet — waiting on user.
        expect(mockSubmitReview).not.toHaveBeenCalled()
    })

    it('continues the submit after the user confirms in the modal', async () => {
        mockCheckStaleness.mockResolvedValue({ isStale: true })
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })
        const confirmBtn = await screen.findByRole('button', { name: /submit review/i })

        await act(async () => {
            fireEvent.click(confirmBtn)
        })

        await waitFor(() => {
            expect(mockSubmitReview).toHaveBeenCalledTimes(1)
        })
        expect(mockSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
            event: 'APPROVE',
            body: 'lgtm',
        }))
    })

    it('cancels the submit when the user dismisses the modal', async () => {
        mockCheckStaleness.mockResolvedValue({ isStale: true })
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })
        const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i })

        await act(async () => {
            fireEvent.click(cancelBtn)
        })

        // Modal gone, no submit fired.
        await waitFor(() => {
            expect(screen.queryByText(/PR updated since you started/i)).not.toBeInTheDocument()
        })
        expect(mockSubmitReview).not.toHaveBeenCalled()
    })

    it('locks the toolbar while the staleness modal is open to prevent double-submit', async () => {
        mockCheckStaleness.mockResolvedValue({ isStale: true })
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })
        await waitFor(() => {
            expect(screen.getByTestId('submitting-flag')).toHaveTextContent('yes')
        })
    })

    it('surfaces the error via toast when the staleness check itself throws', async () => {
        mockCheckStaleness.mockRejectedValue(new Error('network down'))
        renderView()

        await act(async () => {
            fireEvent.click(screen.getByTestId('submit-approve'))
        })

        await waitFor(() => {
            // formatUserError strips raw messages from the UI; the helper now
            // routes the exception through errorFromException with a contextual
            // fallback title rather than echoing err.message.
            expect(mockToastErrorFromException).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({ fallbackTitle: expect.stringContaining('staleness') }),
            )
        })
        expect(mockSubmitReview).not.toHaveBeenCalled()
    })
})
