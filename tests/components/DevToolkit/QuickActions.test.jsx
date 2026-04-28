import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'

// QuickActions now sends a CSRF header on review POST; stub the token fetch
// so it doesn't consume the test's mocked fetch response.
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

import { QuickActions } from '@/components/DevToolkit/ReviewTab/QuickActions'
import { renderWithProviders } from '../../helpers/render-with-providers'

let fetchMock

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('QuickActions — review submit toasts', () => {
    it('fires a success toast when an approval succeeds', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })

        renderWithProviders(
            <QuickActions owner="acme" repo="web" pullNumber={42} onSubmitted={() => {}} />
        )

        // Click "Quick Approve" to reveal the confirmation panel
        const approveBtn = screen.getByRole('button', { name: /quick approve/i })
        fireEvent.click(approveBtn)

        // Submit the approval (the revealed Approve button)
        const submit = screen.getByRole('button', { name: /^approve$/i })
        await act(async () => { fireEvent.click(submit) })

        await waitFor(() => {
            expect(screen.getByText(/pr approved/i)).toBeInTheDocument()
        })
    })

    it('fires an error toast when the review submit fails', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })

        renderWithProviders(
            <QuickActions owner="acme" repo="web" pullNumber={42} onSubmitted={() => {}} />
        )

        fireEvent.click(screen.getByRole('button', { name: /quick approve/i }))
        const submit = screen.getByRole('button', { name: /^approve$/i })
        await act(async () => { fireEvent.click(submit) })

        await waitFor(() => {
            // Toast error is "Failed to submit review — ..."
            expect(screen.getAllByText(/failed to submit review/i).length).toBeGreaterThanOrEqual(1)
        })
    })
})
