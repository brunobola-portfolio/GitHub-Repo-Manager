// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks must be declared before importing the SUT
vi.mock('../db.js', () => {
    const mockPrepare = vi.fn()
    return {
        default: { prepare: mockPrepare },
        __mockPrepare: mockPrepare,
    }
})

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../config.js', () => ({
    config: {
        stripeSecretKey: 'sk_test_fake',
        stripeWebhookSecret: 'whsec_test_fake',
    },
}))

const mockStripeInstance = {
    webhooks: { constructEvent: vi.fn() },
    checkout: {
        sessions: {
            listLineItems: vi.fn(),
        },
    },
}

vi.mock('../lib/stripe.js', () => ({
    getStripe: vi.fn(() => mockStripeInstance),
    isStripeEnabled: vi.fn(() => true),
}))

import { default as db, __mockPrepare as mockPrepare } from '../db.js'
import { stripeWebhookHandler } from '../routes/stripe-webhooks.js'

function makeReqRes({ headers = {}, body = Buffer.from('{}') } = {}) {
    const req = { headers, body }
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this },
        json(payload) { this.body = payload; return this },
    }
    return { req, res }
}

function preparePrescription(rows) {
    // rows: array of { sql: regex|string, get?: result, run?: result }
    mockPrepare.mockImplementation((sql) => {
        const match = rows.find((r) => (r.sql instanceof RegExp ? r.sql.test(sql) : sql.includes(r.sql)))
        if (!match) {
            return { get: vi.fn(() => undefined), run: vi.fn(), all: vi.fn(() => []) }
        }
        return {
            get: vi.fn(() => match.get),
            run: vi.fn(() => match.run ?? { changes: 1 }),
            all: vi.fn(() => match.all ?? []),
        }
    })
}

describe('stripeWebhookHandler', () => {
    beforeEach(() => {
        mockPrepare.mockReset()
        mockStripeInstance.webhooks.constructEvent.mockReset()
        mockStripeInstance.checkout.sessions.listLineItems.mockReset()
    })

    afterEach(() => { vi.clearAllMocks() })

    it('returns 400 when signature verification fails', async () => {
        mockStripeInstance.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig') })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(400)
        expect(res.body).toEqual({ error: 'Invalid signature' })
    })

    it('deduplicates a previously-processed event (idempotency via INSERT OR IGNORE)', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_123', type: 'checkout.session.completed', data: { object: {} },
        })
        // INSERT OR IGNORE returns changes=0 when the row already exists
        preparePrescription([
            { sql: /INSERT OR IGNORE INTO webhook_events/, run: { changes: 0 } },
        ])
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({ received: true, deduped: true })
    })

    it('records a new event id and processes checkout.session.completed', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_new',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_1',
                    metadata: { userId: '42', tier: 'pro' },
                    customer: 'cus_1',
                    subscription: 'sub_1',
                },
            },
        })
        // Price metadata agrees with session metadata
        mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
            data: [{ price: { metadata: { tier: 'pro' } } }],
        })
        preparePrescription([
            { sql: /INSERT OR IGNORE INTO webhook_events/, run: { changes: 1 } },
            { sql: /INSERT INTO user_subscriptions/, run: { changes: 1 } },
        ])

        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({ received: true })

        const inserts = mockPrepare.mock.calls.map((c) => c[0])
        expect(inserts.some((s) => /INSERT OR IGNORE INTO webhook_events/.test(s))).toBe(true)
        expect(inserts.some((s) => /INSERT INTO user_subscriptions/.test(s))).toBe(true)
    })

    it('prefers price tier when session metadata disagrees', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_mismatch',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_2',
                    metadata: { userId: '7', tier: 'pro' }, // session says pro
                    customer: 'cus_2',
                    subscription: 'sub_2',
                },
            },
        })
        // Price says enterprise — must win
        mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
            data: [{ price: { metadata: { tier: 'enterprise' } } }],
        })
        let capturedTier = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/INSERT INTO user_subscriptions/.test(sql)) {
                return { run: vi.fn((...args) => { capturedTier = args[1]; return { changes: 1 } }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })

        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(capturedTier).toBe('enterprise')
    })

    it('returns 503 when stripe is not configured', async () => {
        const { isStripeEnabled } = await import('../lib/stripe.js')
        isStripeEnabled.mockReturnValueOnce(false)
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(503)
    })

    it('returns 500 if the webhook ledger insert fails for a non-dedup reason', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_err', type: 'invoice.paid', data: { object: { subscription: 'sub_x' } },
        })
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) {
                return { run: vi.fn(() => { throw new Error('disk full') }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(500)
        expect(res.body).toEqual({ error: 'Webhook ledger failure' })
    })

    // ------------------------------------------------------------------
    // customer.subscription.updated — tier reconciliation + period window
    // ------------------------------------------------------------------
    it('customer.subscription.updated — uses price metadata as source of truth and updates the subscription row', async () => {
        const periodStart = 1_700_000_000
        const periodEnd = 1_702_592_000
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_sub_upd',
            type: 'customer.subscription.updated',
            data: {
                object: {
                    id: 'sub_abc',
                    status: 'active',
                    current_period_start: periodStart,
                    current_period_end: periodEnd,
                    metadata: { tier: 'pro' },
                    items: { data: [{ price: { metadata: { tier: 'enterprise' } } }] },
                },
            },
        })
        let capturedUpdate = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) {
                return { run: vi.fn(() => ({ changes: 1 })) }
            }
            if (/UPDATE user_subscriptions SET\s+tier/i.test(sql)) {
                return {
                    run: vi.fn((...args) => {
                        capturedUpdate = { tier: args[0], status: args[1], periodStart: args[2], periodEnd: args[3], subId: args[4] }
                        return { changes: 1 }
                    }),
                }
            }
            return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(capturedUpdate).not.toBeNull()
        // price metadata wins over session/sub metadata
        expect(capturedUpdate.tier).toBe('enterprise')
        expect(capturedUpdate.status).toBe('active')
        expect(capturedUpdate.subId).toBe('sub_abc')
        expect(capturedUpdate.periodStart).toBe(new Date(periodStart * 1000).toISOString())
        expect(capturedUpdate.periodEnd).toBe(new Date(periodEnd * 1000).toISOString())
    })

    it('customer.subscription.updated — transitions status from active to past_due when Stripe reports it', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_sub_upd2',
            type: 'customer.subscription.updated',
            data: {
                object: {
                    id: 'sub_def',
                    status: 'past_due',
                    current_period_start: 1_700_000_000,
                    current_period_end: 1_702_592_000,
                    metadata: { tier: 'pro' },
                    items: { data: [{ price: { metadata: { tier: 'pro' } } }] },
                },
            },
        })
        let capturedStatus = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions SET\s+tier/i.test(sql)) {
                return { run: vi.fn((...args) => { capturedStatus = args[1]; return { changes: 1 } }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(capturedStatus).toBe('past_due')
        expect(res.statusCode).toBe(200)
    })

    // ------------------------------------------------------------------
    // customer.subscription.deleted — downgrade to free + cancelled
    // ------------------------------------------------------------------
    it('customer.subscription.deleted — downgrades user to free tier and sets status=cancelled', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_sub_del',
            type: 'customer.subscription.deleted',
            data: { object: { id: 'sub_zzz', status: 'canceled' } },
        })
        let capturedSubId = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions SET tier = 'free', status = 'cancelled'/.test(sql)) {
                return { run: vi.fn((...args) => { capturedSubId = args[0]; return { changes: 1 } }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(capturedSubId).toBe('sub_zzz')
    })

    // ------------------------------------------------------------------
    // invoice.payment_failed — flip to past_due only when subscription id present
    // ------------------------------------------------------------------
    it('invoice.payment_failed — marks subscription past_due when invoice has subscription id', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_pay_fail',
            type: 'invoice.payment_failed',
            data: { object: { subscription: 'sub_pay1' } },
        })
        let capturedSubId = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions SET status = 'past_due'/.test(sql)) {
                return { run: vi.fn((...args) => { capturedSubId = args[0]; return { changes: 1 } }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(capturedSubId).toBe('sub_pay1')
    })

    it('invoice.payment_failed — skips update when subscription id is missing (one-off invoice)', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_pay_fail_oneoff',
            type: 'invoice.payment_failed',
            data: { object: { subscription: null } },
        })
        const updateRun = vi.fn(() => ({ changes: 0 }))
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions SET status = 'past_due'/.test(sql)) {
                return { run: updateRun }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(updateRun).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------
    // invoice.paid — recover past_due → active
    // ------------------------------------------------------------------
    it('invoice.paid — flips subscription back to active when Stripe reports payment', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_paid',
            type: 'invoice.paid',
            data: { object: { subscription: 'sub_rec1' } },
        })
        let capturedSubId = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions SET status = 'active'/.test(sql)) {
                return { run: vi.fn((...args) => { capturedSubId = args[0]; return { changes: 1 } }) }
            }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(capturedSubId).toBe('sub_rec1')
    })

    it('unknown event types return 200 without side effects (forward-compat)', async () => {
        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_unknown',
            type: 'customer.cash_balance.created',
            data: { object: {} },
        })
        const updateRun = vi.fn()
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
            if (/UPDATE user_subscriptions/.test(sql)) return { run: updateRun }
            return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
        })
        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({ received: true })
        expect(updateRun).not.toHaveBeenCalled()
    })
})
