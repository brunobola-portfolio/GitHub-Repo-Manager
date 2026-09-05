import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Same-origin, non-mock so the page performs real fetches. Must mock before import.
vi.mock('@/config', () => ({
    MOCK_MODE: false,
    API_BASE_URL: '',
}))


const { PricingPage } = await import('@/components/Pricing/PricingPage.jsx')
const { _resetCsrfTokenForTests } = await import('@/utils/api')

function mockCsrfToken() {
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ token: 'csrf-test-token' }) }
}

const TOGGLE_LABEL = 'Toggle yearly billing'

function mockConfigResponse(body) {
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
}

describe('PricingPage — yearly billing toggle feature-detection', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
        _resetCsrfTokenForTests()
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
        // 1st fetch: /billing/config → yearly available. 2nd: CSRF token probe
        // (apiCall injects it itself). 3rd: /billing/checkout.
        global.fetch
            .mockResolvedValueOnce(mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: true }))
            .mockResolvedValueOnce(mockCsrfToken())
            .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) }) // no url → no navigation

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
            .mockResolvedValueOnce(mockCsrfToken())
            .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) })

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

/*
 * The displayed price was hardcoded (TIERS_MONTHLY.price = 19, rendered with a
 * hardcoded `$`), while /billing/config returned booleans only. An operator
 * whose Stripe price is not $19/mo shipped a page advertising one number and a
 * checkout charging another, with nothing to catch it. The amount lives in
 * Stripe, so it has to come from there.
 */
describe('PricingPage — advertises the operator real Stripe price', () => {
    beforeEach(() => { global.fetch = vi.fn() })
    afterEach(() => { vi.restoreAllMocks() })

    function withPrices(prices) {
        global.fetch.mockResolvedValue(mockConfigResponse({
            stripeEnabled: true, yearlyBillingAvailable: true, prices,
        }))
    }

    it('renders the Stripe amount and currency instead of the built-in default', async () => {
        withPrices({ pro: { monthly: { amount: 2900, currency: 'eur', interval: 'month' } } })
        render(<PricingPage />)
        await waitFor(() => expect(screen.getByText('€29')).toBeInTheDocument())
        expect(screen.queryByText('$19')).not.toBeInTheDocument()
    })

    it('derives the yearly headline from the real yearly price, not a fixed 20% off', async () => {
        // 24000/yr against 2900/mo is a 31% saving — the hardcoded "Save 20%"
        // would have understated it and contradicted the checkout.
        withPrices({
            pro: {
                monthly: { amount: 2900, currency: 'eur', interval: 'month' },
                yearly: { amount: 24000, currency: 'eur', interval: 'year' },
            },
        })
        render(<PricingPage />)
        await waitFor(() => expect(screen.getByText('€29')).toBeInTheDocument())
        fireEvent.click(screen.getByLabelText(TOGGLE_LABEL))
        await waitFor(() => expect(screen.getByText('€20')).toBeInTheDocument())
        expect(screen.getByText(/Billed €240\/year/)).toBeInTheDocument()
    })

    it('keeps its built-in default when the server resolves no price', async () => {
        // Self-hosted with billing off: the number is decorative there, but it
        // must not vanish or render as NaN.
        withPrices({})
        render(<PricingPage />)
        await waitFor(() => expect(screen.getByText('$19')).toBeInTheDocument())
    })
})
