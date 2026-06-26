import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'

// QuickActions submits reviews through the shared apiCall layer (which injects
// and rotates the CSRF token + retries internally). Mock that boundary to drive
// the success / failure paths rather than the raw fetch underneath it.
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, apiCall: vi.fn() }
})

import { apiCall } from '@/utils/api'
import { QuickActions } from '@/components/DevToolkit/ReviewTab/QuickActions'
import { renderWithProviders } from '../../helpers/render-with-providers'

beforeEach(() => {
    apiCall.mockReset()
})

describe('QuickActions — review submit toasts', () => {
    it('fires a success toast when an approval succeeds', async () => {
        apiCall.mockResolvedValueOnce({})

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
        apiCall.mockRejectedValueOnce(Object.assign(new Error('Failed'), { status: 500, data: {} }))

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
