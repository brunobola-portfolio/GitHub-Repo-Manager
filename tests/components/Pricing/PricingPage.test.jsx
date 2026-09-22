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

describe('PricingPage — the Pro button follows what this instance can charge', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
        _resetCsrfTokenForTests()
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    const checkoutCalls = () =>
        global.fetch.mock.calls.filter(([url]) => String(url).includes('/billing/checkout'))

    it('offers contact, not checkout, when the probe says Stripe is off', async () => {
        // This page asked /billing/config and read only the yearly flag and the
        // prices, ignoring stripeEnabled — so a signed-in visitor clicked
        // "Upgrade to Pro", waited for a 503, and read an error banner to find
        // out the instance cannot sell it. The landing page was fixed in
        // 4.25.2; this one was not.
        global.fetch.mockResolvedValue(
            mockConfigResponse({ stripeEnabled: false, yearlyBillingAvailable: false, prices: {} }),
        )

        render(<PricingPage />)

        const cta = await waitFor(() => screen.getByRole('button', { name: /contact us about pro/i }))
        await act(async () => { fireEvent.click(cta) })

        expect(checkoutCalls()).toHaveLength(0)
    })

    it('starts a checkout when the probe says Stripe is on', async () => {
        global.fetch.mockImplementation(async (url) => {
            if (String(url).includes('/billing/config')) {
                return mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: false, prices: {} })
            }
            if (String(url).includes('/csrf')) return mockCsrfToken()
            return mockConfigResponse({ url: 'https://checkout.stripe.test/session' })
        })

        render(<PricingPage />)

        const cta = await waitFor(() => screen.getByRole('button', { name: /upgrade to pro/i }))
        await act(async () => { fireEvent.click(cta) })

        await waitFor(() => expect(checkoutCalls().length).toBeGreaterThan(0))
    })

    it('keeps the Pro label while the probe has not answered, rather than flickering', async () => {
        // `null`, not `false`: a page that renders "Contact us" for a moment
        // and then switches to "Upgrade" reads as broken.
        global.fetch.mockImplementation(() => new Promise(() => {}))

        render(<PricingPage />)

        expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /contact us about pro/i })).not.toBeInTheDocument()
    })
})

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
        // must not vanish or render as NaN. The default currency is EUR because
        // that is what every published plan quotes and what the Stripe prices
        // actually charge — a card rendering "$19" for a price that takes €19
        // was the mismatch this default used to create.
        withPrices({})
        render(<PricingPage />)
        await waitFor(() => expect(screen.getByText('€19')).toBeInTheDocument())
    })
})

/*
 * The Stripe-missing banner told every visitor "This self-hosted deployment
 * doesn't have Stripe configured" — false on the hosted instance, which is a
 * saas deployment. Nothing server-side tells the client which mode it is in
 * (/api/v1/billing/config returns stripeEnabled / yearlyBillingAvailable /
 * prices and nothing else), so the copy has to hold for both.
 */
describe('PricingPage — the checkout-unavailable banner names no deployment type', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
        _resetCsrfTokenForTests()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    async function renderBannerAfter503() {
        // The probe must say Stripe IS enabled. Since the Pro button reads
        // `stripeEnabled`, a `false` here means the button becomes a contact
        // link and checkout is never called — so the banner this suite exists
        // to test would be unreachable. Its real scenario is the mismatch:
        // the probe answered yes and the checkout 503s anyway (a key removed
        // mid-session, a mid-deploy change, a self-host whose operator unset
        // it). That is why the banner stays.
        global.fetch
            .mockResolvedValueOnce(mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: false }))
            .mockResolvedValueOnce(mockCsrfToken())
        // Every later attempt: Stripe missing. 503 is retryable, so apiCall
        // sleeps between four attempts — fake timers skip the backoff instead
        // of adding ~8s of real waiting to the suite.
        global.fetch.mockResolvedValue({
            ok: false,
            status: 503,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Stripe is not configured' }),
        })

        render(<PricingPage />)
        const proCta = await screen.findByRole('button', { name: /Upgrade to Pro/i })

        vi.useFakeTimers()
        await act(async () => { fireEvent.click(proCta) })
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
        vi.useRealTimers()
    }

    it('explains the block without claiming the deployment is self-hosted', async () => {
        await renderBannerAfter503()

        const reason = screen.getByText(/Continue on Free/)
        expect(reason.textContent).not.toMatch(/self-host/i)
        expect(reason.textContent).not.toMatch(/deployment/i)
    })

    it('points at the contact route the page already uses', async () => {
        await renderBannerAfter503()

        const contact = screen.getAllByRole('link').find((a) => {
            const href = a.getAttribute('href') || ''
            return href.startsWith('mailto:') && href.includes('subject=')
        })
        expect(contact, 'the banner offers no way to ask for Pro').toBeTruthy()
        expect(contact.getAttribute('href')).toMatch(/Pro%20license%20inquiry/)
    })
})

/*
 * A visitor who clicked "Upgrade to Pro" on the landing page signs in first
 * and comes back to /pricing?checkout=pro. The page honours that intent once
 * the probe confirms this instance can charge, so the buyer is not asked to
 * find the button a second time.
 */
describe('PricingPage — resumes a checkout intent carried through sign-in', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
        _resetCsrfTokenForTests()
    })
    afterEach(() => {
        vi.restoreAllMocks()
        window.history.replaceState(null, '', '/')
    })

    const checkoutCalls = () =>
        global.fetch.mock.calls.filter(([url]) => String(url).includes('/billing/checkout'))

    it('starts the checkout once and strips the parameter when Stripe is on', async () => {
        window.history.replaceState(null, '', '/?checkout=pro')
        global.fetch.mockImplementation(async (url) => {
            if (String(url).includes('/billing/config')) {
                return mockConfigResponse({ stripeEnabled: true, yearlyBillingAvailable: false, prices: {} })
            }
            if (String(url).includes('/csrf')) return mockCsrfToken()
            return mockConfigResponse({ url: 'https://checkout.stripe.test/session' })
        })
        render(<PricingPage />)
        await waitFor(() => expect(checkoutCalls()).toHaveLength(1))
        expect(window.location.search).toBe('')
    })

    it('does nothing with the parameter when the probe says Stripe is off', async () => {
        window.history.replaceState(null, '', '/?checkout=pro')
        global.fetch.mockResolvedValue(
            mockConfigResponse({ stripeEnabled: false, yearlyBillingAvailable: false, prices: {} }),
        )
        render(<PricingPage />)
        await waitFor(() => screen.getByRole('button', { name: /contact us about pro/i }))
        expect(checkoutCalls()).toHaveLength(0)
        expect(window.location.search).toBe('')
    })
})
