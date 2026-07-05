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
const mockStripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    checkout: { sessions: { create: mockSessionsCreate } },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://portal.test' })) } },
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

const { default: billingRouter } = await import('../routes/billing.js')

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
    mockPrepare.mockReset()
    // Existing customer so the route skips customer creation + insert.
    mockPrepare.mockImplementation(() => ({
        get: vi.fn(() => ({ stripe_customer_id: 'cus_existing' })),
        run: vi.fn(() => ({ changes: 1 })),
    }))
})

describe('GET /billing/config — yearly feature-detect', () => {
    it('advertises yearly when Stripe is enabled AND a Pro yearly price is configured', async () => {
        const res = await request(makeApp()).get('/api/v1/billing/config')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ stripeEnabled: true, yearlyBillingAvailable: true })
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
        expect(res.body).toEqual({ stripeEnabled: false, yearlyBillingAvailable: false })
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
        expect(res.body).toEqual({ error: 'Invalid input' })
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
