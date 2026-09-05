import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const REVIEWS = [
    { repoFullName: 'acme/api', prNumber: 7, title: 'Fix the thing', authorLogin: 'octo', ageHours: 30 },
]

vi.mock('@/hooks/useWorkBoard', () => ({
    useMyPendingReviews: () => ({ data: REVIEWS, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/hooks/useReviewAction', () => ({
    useReviewAction: () => ({
        approve: vi.fn(),
        snooze: vi.fn(),
        requestChanges: vi.fn(),
    }),
}))

// The row menu pulls the tracked-repos context, which is irrelevant to the
// draft-modal lifecycle under test.
vi.mock('@/components/WorkBoard/WorkBoardRowMenu', () => ({
    WorkBoardRowMenu: () => null,
}))

vi.mock('@/utils/api', async (importOriginal) => ({
    ...(await importOriginal()),
    getCsrfToken: vi.fn(async () => 'csrf-token'),
}))

const { MyReviewsTab } = await import('@/components/WorkBoard/tabs/MyReviewsTab')

describe('MyReviewsTab — DraftCommentModal lifecycle (FE-06)', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('unmounting before the draft resolves leaves no interval running', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

        // Hold the response open so the unmount lands mid-flight — the exact
        // window in which the old code assigned intervalRef after cleanup ran.
        let resolveFetch
        const pending = new Promise((resolve) => { resolveFetch = resolve })
        vi.stubGlobal('fetch', vi.fn(() => pending))

        const { unmount } = render(<MyReviewsTab hasAI />)
        await user.click(screen.getByLabelText('Request changes'))
        expect(await screen.findByRole('dialog')).toBeInTheDocument()

        unmount()

        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
        await act(async () => {
            resolveFetch({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ draft: 'Please rebase.' }) })
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
        })

        // The 25 ms typewriter must never start for a modal that is gone —
        // the old code registered it after cleanup had already run.
        expect(setIntervalSpy).not.toHaveBeenCalled()
        await act(async () => { vi.advanceTimersByTime(1000) })
        expect(setIntervalSpy).not.toHaveBeenCalled()
        setIntervalSpy.mockRestore()
    })

    it('surfaces a failed draft through the shared error vocabulary instead of an empty textarea', async () => {
        const user = userEvent.setup()
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Unexpected token < in JSON at position 0' }),
        })))

        render(<MyReviewsTab hasAI />)
        await user.click(screen.getByLabelText('Request changes'))

        const alert = await screen.findByRole('alert')
        expect(alert).toBeInTheDocument()
        // The raw provider/parser string must not reach the user.
        expect(alert.textContent).not.toMatch(/Unexpected token/)
        expect(alert.textContent).toMatch(/Draft comment/)
    })
})
