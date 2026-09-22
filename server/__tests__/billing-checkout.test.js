// @vitest-environment node
/**
 * Billing checkout route — billing-period selection + yearly feature-detect.
 *
 * Locks the honesty contract for the pricing page's monthly/yearly toggle:
 *   1. GET  /config advertises yearly only when a real Pro yearly price is set.
 *   2. POST /checkout maps (tier, billingPeriod) → the MATCHING Stripe price ID,
 *      and 400s when a requested yearly price is not configured — it must never
 *      silently fall back to the monthly price and mis-charge the buyer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mutable so individual tests can flip yearly on/off between requests. The
// route reads these at call time (resolvePriceId / isYearlyBillingAvailable),
// so mutating a property changes behaviour without re-mocking the module.
const mockConfig = {
    stripePriceProMonthly: 'price_pro_monthly',
    stripePriceProYearly: 'price_pro_yearly',
    stripePriceEnterpriseMonthly: 'price_ent_monthly',
    stripePriceEnterpriseYearly: 'price_ent_yearly',
    frontendUrl: 'http://localhost:5173',
}
vi.mock('../config.js', () => ({ config: mockConfig }))

let stripeEnabled = true
const mockSessionsCreate = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }))
const mockPricesRetrieve = vi.fn(async (id) => ({
    id,
    unit_amount: id === 'price_pro_yearly' ? 19000 : 2900,
    currency: 'eur',
    recurring: { interval: id.endsWith('yearly') ? 'year' : 'month' },
}))
const mockStripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    checkout: { sessions: { create: mockSessionsCreate } },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://portal.test' })) } },
    prices: { retrieve: (...a) => mockPricesRetrieve(...a) },
}
vi.mock('../lib/stripe.js', () => ({
    getStripe: () => mockStripe,
    isStripeEnabled: () => stripeEnabled,
}))

const mockPrepare = vi.fn()
vi.mock('../db.js', () => ({ default: { prepare: (...a) => mockPrepare(...a) } }))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => { req.session = { userId: 42 }; next() },
}))
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { default: billingRouter, invalidatePriceCache } = await import('../routes/billing.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/billing', billingRouter)
    return app
}

function priceOf(callIndex = 0) {
    return mockSessionsCreate.mock.calls[callIndex][0].line_items[0].price
}

beforeEach(() => {
    stripeEnabled = true
    mockConfig.stripePriceProMonthly = 'price_pro_monthly'
    mockConfig.stripePriceProYearly = 'price_pro_yearly'
    mockConfig.stripePriceEnterpriseMonthly = 'price_ent_monthly'
    mockConfig.stripePriceEnterpriseYearly = 'price_ent_yearly'
    mockSessionsCreate.mockClear()
    mockPricesRetrieve.mockClear()
    invalidatePriceCache()
    mockPrepare.mockReset()
    // Existing customer so the route skips customer creation + insert.
    mockPrepare.mockImplementation(() => ({
        get: vi.fn(() => ({ stripe_customer_id: 'cus_existing' })),
        run: vi.fn(() => ({ changes: 1 })),
    }))
})

describe('POST /billing/checkout — tax collection is opt-in per deployment', () => {
    it('collects address and VAT id and enables automatic tax when STRIPE_AUTOMATIC_TAX is on', async () => {
        mockConfig.stripeAutomaticTax = true
        const res = await request(makeApp()).post('/api/v1/billing/checkout').send({ tier: 'pro' })
        expect(res.status).toBe(200)
        expect(mockSessionsCreate.mock.calls.at(-1)[0]).toMatchObject({
            automatic_tax: { enabled: true },
            billing_address_collection: 'required',
            tax_id_collection: { enabled: true },
            customer_update: { address: 'auto', name: 'auto' },
        })
        mockConfig.stripeAutomaticTax = false
    })

    it('sends none of it when off, so an account without Stripe Tax still checks out', async () => {
        // automatic_tax makes Stripe refuse the session unless Tax is set up
        // with a registration; a self-hosted operator must not inherit that.
        mockConfig.stripeAutomaticTax = false
        const res = await request(makeApp()).post('/api/v1/billing/checkout').send({ tier: 'pro' })
        expect(res.status).toBe(200)
        const params = mockSessionsCreate.mock.calls.at(-1)[0]
        for (const k of ['automatic_tax', 'billing_address_collection', 'tax_id_collection', 'customer_update']) {
            expect(params).not.toHaveProperty(k)
        }
    })
})

describe('POST /billing/portal — names the configuration when one is set', () => {
    // A configuration created through the API is never Stripe's "default",
    // and a portal session created without naming one fails in live mode —
    // the one button that lets a customer cancel would 500.
    it('passes STRIPE_PORTAL_CONFIGURATION through to Stripe', async () => {
        mockConfig.stripePortalConfiguration = 'bpc_test'
        const res = await request(makeApp()).post('/api/v1/billing/portal')
        expect(res.status).toBe(200)
        expect(mockStripe.billingPortal.sessions.create.mock.calls.at(-1)[0]).toMatchObject({ configuration: 'bpc_test' })
        delete mockConfig.stripePortalConfiguration
    })

    it('omits the field when none is configured, so a Dashboard default still applies', async () => {
        delete mockConfig.stripePortalConfiguration
        const res = await request(makeApp()).post('/api/v1/billing/portal')
        expect(res.status).toBe(200)
        expect(mockStripe.billingPortal.sessions.create.mock.calls.at(-1)[0]).not.toHaveProperty('configuration')
    })
})

describe('GET /billing/config — yearly feature-detect', () => {
    it('advertises yearly when Stripe is enabled AND a Pro yearly price is configured', async () => {
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ stripeEnabled: true, yearlyBillingAvailable: true, prices: expect.any(Object) })
    })

    it('hides yearly when the Pro yearly price is NOT configured', async () => {
        mockConfig.stripePriceProYearly = undefined
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body.stripeEnabled).toBe(true)
        expect(res.body.yearlyBillingAvailable).toBe(false)
    })

    it('hides yearly (and reports Stripe off) when Stripe is disabled', async () => {
        stripeEnabled = false
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ stripeEnabled: false, yearlyBillingAvailable: false, prices: {} })
    })
})

describe('POST /billing/checkout — billing-period price selection', () => {
    it('defaults to the monthly price when billingPeriod is omitted (back-compat)', async () => {
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro' })
        expect(res.status).toBe(200)
        expect(priceOf()).toBe('price_pro_monthly')
    })

    it('selects the monthly price for billingPeriod=monthly', async () => {
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro', billingPeriod: 'monthly' })
        expect(res.status).toBe(200)
        expect(priceOf()).toBe('price_pro_monthly')
    })

    it('selects the Pro YEARLY price for billingPeriod=yearly', async () => {
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro', billingPeriod: 'yearly' })
        expect(res.status).toBe(200)
        expect(priceOf()).toBe('price_pro_yearly')
        // Period is threaded into Stripe metadata so the webhook/portal agree.
        expect(mockSessionsCreate.mock.calls[0][0].metadata).toMatchObject({ billingPeriod: 'yearly', tier: 'pro' })
    })

    it('selects the Enterprise YEARLY price for enterprise + yearly', async () => {
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'enterprise', billingPeriod: 'yearly' })
        expect(res.status).toBe(200)
        expect(priceOf()).toBe('price_ent_yearly')
    })

    it('400s (never falls back to monthly) when a yearly price is requested but not configured', async () => {
        mockConfig.stripePriceProYearly = undefined
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro', billingPeriod: 'yearly' })
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/not configured/i)
        expect(mockSessionsCreate).not.toHaveBeenCalled()
    })

    it('rejects an invalid billingPeriod value', async () => {
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro', billingPeriod: 'weekly' })
        expect(res.status).toBe(400)
        expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' })
        expect(mockSessionsCreate).not.toHaveBeenCalled()
    })

    it('503s when Stripe is not configured', async () => {
        stripeEnabled = false
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro', billingPeriod: 'yearly' })
        expect(res.status).toBe(503)
    })
})

/**
 * The double-charge guard. Refunding an invoice does NOT cancel the Stripe
 * subscription, so a refunded or disputed customer sees a Free UI over a live
 * subscription — clicking Upgrade would open a SECOND one and bill them twice
 * while the webhook's ON CONFLICT(user_id) upsert orphans the first.
 */
describe('POST /billing/checkout — refuses to open a second subscription', () => {
    function withSubscription(row) {
        mockPrepare.mockImplementation(() => ({
            get: vi.fn(() => row),
            run: vi.fn(() => ({ changes: 1 })),
        }))
    }

    for (const status of ['active', 'trialing', 'past_due', 'incomplete']) {
        it(`409s subscription_exists for status='${status}'`, async () => {
            withSubscription({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status })
            const res = await request(makeApp())
                .post('/api/v1/billing/checkout')
                .send({ tier: 'pro' })
            expect(res.status).toBe(409)
            expect(res.body.error).toBe('subscription_exists')
            expect(mockSessionsCreate).not.toHaveBeenCalled()
        })
    }

    for (const status of ['refunded', 'disputed']) {
        it(`409s subscription_on_hold for status='${status}' instead of double-billing`, async () => {
            withSubscription({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status })
            const res = await request(makeApp())
                .post('/api/v1/billing/checkout')
                .send({ tier: 'pro' })
            expect(res.status).toBe(409)
            expect(res.body.error).toBe('subscription_on_hold')
            expect(mockSessionsCreate).not.toHaveBeenCalled()
        })
    }

    it("allows checkout again once the subscription is genuinely cancelled", async () => {
        withSubscription({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'cancelled' })
        const res = await request(makeApp())
            .post('/api/v1/billing/checkout')
            .send({ tier: 'pro' })
        expect(res.status).toBe(200)
        expect(mockSessionsCreate).toHaveBeenCalledTimes(1)
    })
})

/*
 * The displayed price was hardcoded in PricingPage.jsx and /billing/config
 * returned booleans only, so an operator whose Stripe price is not $19/mo
 * shipped a page advertising one number and a checkout charging another, with
 * nothing to catch it. The amount lives in Stripe (operators configure price
 * IDs, not amounts), so the only honest source is Stripe itself.
 */
describe('GET /config — real prices from Stripe', () => {
    it('returns the configured price amount and currency, not a hardcoded guess', async () => {
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body.prices.pro.monthly).toMatchObject({ amount: 2900, currency: 'eur' })
        expect(res.body.prices.pro.yearly).toMatchObject({ amount: 19000, currency: 'eur' })
    })

    it('resolves each configured tier', async () => {
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.body.prices.enterprise.monthly).toMatchObject({ amount: 2900 })
    })

    it('omits a price it cannot resolve rather than inventing one', async () => {
        mockPricesRetrieve.mockImplementation(async (id) => {
            if (id === 'price_pro_yearly') throw new Error('No such price')
            return { id, unit_amount: 2900, currency: 'usd', recurring: { interval: 'month' } }
        })
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body.prices.pro.monthly).toMatchObject({ amount: 2900 })
        expect(res.body.prices.pro.yearly).toBeUndefined()
    })

    it('reports no prices at all when Stripe is not configured', async () => {
        stripeEnabled = false
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body.stripeEnabled).toBe(false)
        expect(res.body.prices).toEqual({})
        expect(mockPricesRetrieve).not.toHaveBeenCalled()
    })

    it('still reports the existing booleans', async () => {
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.body).toMatchObject({ stripeEnabled: true, yearlyBillingAvailable: true })
    })
})

/*
 * The app routes by hash and reads ?billing= on return. A bare /pricing
 * cancel_url dropped a signed-in buyer on the dashboard with no word about
 * whether anything was charged.
 */
describe('POST /billing/checkout — return URLs the client can act on', () => {
    it('sends the buyer back to pricing with billing=cancel, and to settings with billing=success', async () => {
        const res = await request(makeApp()).post('/api/v1/billing/checkout').send({ tier: 'pro' })
        expect(res.status).toBe(200)
        const args = mockSessionsCreate.mock.calls.at(-1)[0]
        expect(args.cancel_url).toBe('http://localhost:5173/pricing?billing=cancel')
        expect(args.success_url).toBe('http://localhost:5173/settings?billing=success')
    })
})
