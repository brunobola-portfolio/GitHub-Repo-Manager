import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Same-origin, non-mock so the page performs real fetches. Must mock before import.
vi.mock('@/config', () => ({
    MOCK_MODE: false,
    API_BASE_URL: '',
}))

// getCsrfToken is only used on checkout; stub it so the POST path is exercisable.
vi.mock('@/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-test-token'),
}))

const { PricingPage } = await import('@/components/Pricing/PricingPage.jsx')

const TOGGLE_LABEL = 'Toggle yearly billing'

function mockConfigResponse(body) {
    return { ok: true, status: 200, json: async () => body }
}

describe('PricingPage — yearly billing toggle feature-detection', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('shows the monthly/yearly toggle when the backend reports yearly is available', async () => {
        global.fetch.mockResolvedValueOnce(
            mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: true }),
        )

        render(<PricingPage />)

        await waitFor(() => {
            expect(screen.getByLabelText(TOGGLE_LABEL)).toBeInTheDocument()
        })
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/billing/config', expect.objectContaining({
            credentials: 'include',
        }))
    })

    it('hides the toggle when the backend reports yearly is NOT available', async () => {
        global.fetch.mockResolvedValueOnce(
            mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: false }),
        )

        render(<PricingPage />)

        // Let the mount probe resolve, then assert the toggle never appears.
        await waitFor(() => expect(global.fetch).toHaveBeenCalled())
        await Promise.resolve()
        expect(screen.queryByLabelText(TOGGLE_LABEL)).not.toBeInTheDocument()
    })

    it('keeps the toggle hidden when the config probe fails (errs honest)', async () => {
        global.fetch.mockRejectedValueOnce(new Error('network down'))

        render(<PricingPage />)

        await waitFor(() => expect(global.fetch).toHaveBeenCalled())
        await Promise.resolve()
        expect(screen.queryByLabelText(TOGGLE_LABEL)).not.toBeInTheDocument()
    })

    it('threads billingPeriod=yearly through the checkout request after toggling to yearly', async () => {
        // 1st fetch: /billing/config → yearly available. 2nd: /billing/checkout.
        global.fetch
            .mockResolvedValueOnce(mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: true }))
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // no url → no navigation

        render(<PricingPage />)

        const toggle = await screen.findByLabelText(TOGGLE_LABEL)
        await act(async () => { fireEvent.click(toggle) })

        const proCta = screen.getByRole('button', { name: /Upgrade to Pro/i })
        await act(async () => { fireEvent.click(proCta) })

        await waitFor(() => {
            const checkoutCall = global.fetch.mock.calls.find(([url]) => url === '/api/v1/billing/checkout')
            expect(checkoutCall).toBeTruthy()
            expect(JSON.parse(checkoutCall[1].body)).toEqual({ tier: 'pro', billingPeriod: 'yearly' })
        })
    })

    it('sends billingPeriod=monthly when the toggle is available but left on monthly', async () => {
        global.fetch
            .mockResolvedValueOnce(mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: true }))
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

        render(<PricingPage />)

        await screen.findByLabelText(TOGGLE_LABEL)
        const proCta = screen.getByRole('button', { name: /Upgrade to Pro/i })
        await act(async () => { fireEvent.click(proCta) })

        await waitFor(() => {
            const checkoutCall = global.fetch.mock.calls.find(([url]) => url === '/api/v1/billing/checkout')
            expect(checkoutCall).toBeTruthy()
            expect(JSON.parse(checkoutCall[1].body)).toEqual({ tier: 'pro', billingPeriod: 'monthly' })
        })
    })
})
