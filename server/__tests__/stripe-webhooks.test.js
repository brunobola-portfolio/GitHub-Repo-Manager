// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks must be declared before importing the SUT
vi.mock('../db.js', () => {
    const mockPrepare = vi.fn()
    // better-sqlite3's db.transaction(fn) returns a function that runs `fn`
    // inside a synchronous BEGIN/COMMIT. For the unit tests we don't exercise
    // real rollback semantics — we just need the wrapper to invoke `fn` and
    // propagate throws, which callers then catch and react to (e.g. by
    // calling forgetIdempotency in the production code).
    const mockTransaction = vi.fn((fn) => (...args) => fn(...args))
    return {
        default: { prepare: mockPrepare, transaction: mockTransaction },
        __mockPrepare: mockPrepare,
        __mockTransaction: mockTransaction,
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
    customers: {
        retrieve: vi.fn(async () => ({ email: 'billing@example.com' })),
    },
    charges: { retrieve: vi.fn() },
    invoices: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
}

vi.mock('../lib/stripe.js', () => ({
    getStripe: vi.fn(() => mockStripeInstance),
    isStripeEnabled: vi.fn(() => true),
}))

// B2: allow individual tests to override issueLicenseForCheckout behaviour
// (including forcing it to throw) so we can verify idempotency rollback.
vi.mock('../lib/license-issuer.js', () => ({
    issueLicenseForCheckout: vi.fn(async () => ({ licenseKey: 'lic_fake', emailDelivered: true })),
}))

import { default as _db, __mockPrepare as mockPrepare } from '../db.js'
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
        mockStripeInstance.customers.retrieve.mockReset()
        mockStripeInstance.customers.retrieve.mockResolvedValue({ email: 'billing@example.com' })
        mockStripeInstance.charges.retrieve.mockReset()
        mockStripeInstance.invoices.retrieve.mockReset()
        mockStripeInstance.subscriptions.retrieve.mockReset()
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

    // ------------------------------------------------------------------
    // B2: idempotency rollback when async license issuance fails
    // ------------------------------------------------------------------
    it('B2: when issueLicenseForCheckout throws, the webhook_events row is rolled back (DELETE fires)', async () => {
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        issueLicenseForCheckout.mockReset()
        issueLicenseForCheckout.mockRejectedValueOnce(new Error('resend outage + signing key broken'))

        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_license_fail',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_fail',
                    metadata: { userId: '99', tier: 'pro' },
                    customer: 'cus_fail',
                    subscription: 'sub_fail',
                },
            },
        })
        mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
            data: [{ price: { metadata: { tier: 'pro' } } }],
        })

        let deleteCalledWith = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) {
                return { run: vi.fn(() => ({ changes: 1 })) }
            }
            if (/INSERT INTO user_subscriptions/.test(sql)) {
                return { run: vi.fn(() => ({ changes: 1 })) }
            }
            if (/SELECT email FROM users/.test(sql)) {
                return { get: vi.fn(() => ({ email: 'user@example.com' })) }
            }
            if (/DELETE FROM webhook_events/.test(sql)) {
                return {
                    run: vi.fn((...args) => {
                        deleteCalledWith = args
                        return { changes: 1 }
                    }),
                }
            }
            return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
        })

        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        // Endpoint signals failure so Stripe retries (our handler replies 500).
        expect(res.statusCode).toBe(500)
        expect(res.body).toEqual({ error: 'License issuance failed' })
        // Idempotency row was explicitly removed.
        expect(deleteCalledWith).not.toBeNull()
        expect(deleteCalledWith[0]).toBe('evt_license_fail')
        expect(deleteCalledWith[1]).toBe('stripe')
    })

    it('B2: when the idempotency+subscription transaction throws, the idempotency insert is rolled back by SQLite', async () => {
        // Simulate a crash in the synchronous subscription upsert. The
        // production code wraps it in db.transaction() so SQLite rolls back
        // the INSERT on throw, and then calls forgetIdempotency() as a
        // belt-and-braces DELETE. Our mock transaction propagates the throw
        // verbatim; we assert the handler explicitly deletes the row AND
        // returns 500 so Stripe's retry re-runs the event.
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        issueLicenseForCheckout.mockReset()

        mockStripeInstance.webhooks.constructEvent.mockReturnValue({
            id: 'evt_sub_fail',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_subfail',
                    metadata: { userId: '11', tier: 'pro' },
                    customer: 'cus_subfail',
                    subscription: 'sub_subfail',
                },
            },
        })
        mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
            data: [{ price: { metadata: { tier: 'pro' } } }],
        })

        let deleteCalledWith = null
        mockPrepare.mockImplementation((sql) => {
            if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) {
                return { run: vi.fn(() => ({ changes: 1 })) }
            }
            if (/INSERT INTO user_subscriptions/.test(sql)) {
                // Simulate DB outage on the subscription upsert.
                return { run: vi.fn(() => { throw new Error('disk i/o error') }) }
            }
            if (/DELETE FROM webhook_events/.test(sql)) {
                return {
                    run: vi.fn((...args) => {
                        deleteCalledWith = args
                        return { changes: 1 }
                    }),
                }
            }
            return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
        })

        const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
        await stripeWebhookHandler(req, res)
        expect(res.statusCode).toBe(500)
        expect(res.body).toEqual({ error: 'Subscription write failed' })
        expect(deleteCalledWith).not.toBeNull()
        expect(deleteCalledWith[0]).toBe('evt_sub_fail')
        // License issuance must NOT have been attempted — we failed before it.
        expect(issueLicenseForCheckout).not.toHaveBeenCalled()
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

    // ------------------------------------------------------------------
    // B3: license key duration matches the actual billing period —
    // checkout.session.completed issues months=1 for monthly, months=12
    // for yearly (session.metadata.billingPeriod, set by routes/billing.js).
    // ------------------------------------------------------------------
    describe('B3 — checkout.session.completed license duration by billingPeriod', () => {
        it('monthly checkout issues a 1-month license and persists billing_period=monthly', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()
            issueLicenseForCheckout.mockResolvedValueOnce({ licenseKey: 'lic_m', emailDelivered: true })

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_monthly',
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'cs_monthly',
                        metadata: { userId: '55', tier: 'pro', billingPeriod: 'monthly' },
                        customer: 'cus_monthly',
                        subscription: 'sub_monthly',
                    },
                },
            })
            mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
                data: [{ price: { metadata: { tier: 'pro' } } }],
            })
            mockStripeInstance.customers.retrieve.mockResolvedValueOnce({ email: 'monthly@example.com' })

            let capturedUpsertArgs = null
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/INSERT INTO user_subscriptions/.test(sql)) {
                    return { run: vi.fn((...args) => { capturedUpsertArgs = args; return { changes: 1 } }) }
                }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).toHaveBeenCalledWith(
                expect.objectContaining({ months: 1, tier: 'pro', userId: 55 })
            )
            // billing_period is threaded through to the upsert (positional
            // bind params include the string 'monthly' twice — INSERT + ON
            // CONFLICT UPDATE branches).
            expect(capturedUpsertArgs).toContain('monthly')
        })

        it('yearly checkout issues a 12-month license and persists billing_period=yearly', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()
            issueLicenseForCheckout.mockResolvedValueOnce({ licenseKey: 'lic_y', emailDelivered: true })

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_yearly',
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'cs_yearly',
                        metadata: { userId: '56', tier: 'pro', billingPeriod: 'yearly' },
                        customer: 'cus_yearly',
                        subscription: 'sub_yearly',
                    },
                },
            })
            mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
                data: [{ price: { metadata: { tier: 'pro' } } }],
            })
            mockStripeInstance.customers.retrieve.mockResolvedValueOnce({ email: 'yearly@example.com' })

            let capturedUpsertArgs = null
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/INSERT INTO user_subscriptions/.test(sql)) {
                    return { run: vi.fn((...args) => { capturedUpsertArgs = args; return { changes: 1 } }) }
                }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).toHaveBeenCalledWith(
                expect.objectContaining({ months: 12, tier: 'pro', userId: 56 })
            )
            expect(capturedUpsertArgs).toContain('yearly')
        })

        it('missing billingPeriod metadata defaults to monthly (1-month key) for older/malformed sessions', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()
            issueLicenseForCheckout.mockResolvedValueOnce({ licenseKey: 'lic_default', emailDelivered: true })

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_no_period',
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'cs_no_period',
                        metadata: { userId: '58', tier: 'pro' }, // no billingPeriod
                        customer: 'cus_no_period',
                        subscription: 'sub_no_period',
                    },
                },
            })
            mockStripeInstance.checkout.sessions.listLineItems.mockResolvedValue({
                data: [{ price: { metadata: { tier: 'pro' } } }],
            })
            mockStripeInstance.customers.retrieve.mockResolvedValueOnce({ email: 'default@example.com' })
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/INSERT INTO user_subscriptions/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).toHaveBeenCalledWith(expect.objectContaining({ months: 1 }))
        })
    })

    // ------------------------------------------------------------------
    // B3: invoice.paid renewal reissues a fresh 1-month license for
    // monthly subs, so the emailed key never outlives the paid period.
    // ------------------------------------------------------------------
    describe('B3 — invoice.paid renewal license reissue', () => {
        it('reissues a fresh 1-month license on a monthly subscription_cycle renewal', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()
            issueLicenseForCheckout.mockResolvedValueOnce({ licenseKey: 'lic_renew', emailDelivered: true })

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_renew_1',
                type: 'invoice.paid',
                data: {
                    object: { id: 'in_renew_1', subscription: 'sub_renew', billing_reason: 'subscription_cycle' },
                },
            })
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/UPDATE user_subscriptions SET status = 'active'/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SELECT user_id, tier, billing_period FROM user_subscriptions/.test(sql)) {
                    return { get: vi.fn(() => ({ user_id: 77, tier: 'pro', billing_period: 'monthly' })) }
                }
                if (/SELECT email FROM users/.test(sql)) return { get: vi.fn(() => ({ email: 'renew@example.com' })) }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 77,
                    tier: 'pro',
                    months: 1,
                    email: 'renew@example.com',
                    stripeSubscriptionId: 'sub_renew',
                    stripeSessionId: 'in_renew_1',
                })
            )
        })

        it('reissues a fresh 12-month license on a yearly subscription_cycle renewal (year-2 customer must get a new key)', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()
            issueLicenseForCheckout.mockResolvedValueOnce({ licenseKey: 'lic_renew_yearly', emailDelivered: true })

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_renew_yearly',
                type: 'invoice.paid',
                data: {
                    object: { id: 'in_renew_yearly', subscription: 'sub_renew_yearly', billing_reason: 'subscription_cycle' },
                },
            })
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/UPDATE user_subscriptions SET status = 'active'/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SELECT user_id, tier, billing_period FROM user_subscriptions/.test(sql)) {
                    return { get: vi.fn(() => ({ user_id: 78, tier: 'pro', billing_period: 'yearly' })) }
                }
                if (/SELECT email FROM users/.test(sql)) return { get: vi.fn(() => ({ email: 'yearly-renew@example.com' })) }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 78,
                    tier: 'pro',
                    months: 12,
                    email: 'yearly-renew@example.com',
                    stripeSubscriptionId: 'sub_renew_yearly',
                    stripeSessionId: 'in_renew_yearly',
                })
            )
        })

        it('does NOT reissue on the very first invoice of a new subscription (billing_reason=subscription_create), avoiding a double-email alongside checkout.session.completed', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_first_invoice',
                type: 'invoice.paid',
                data: {
                    object: { id: 'in_first', subscription: 'sub_first', billing_reason: 'subscription_create' },
                },
            })
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/UPDATE user_subscriptions SET status = 'active'/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).not.toHaveBeenCalled()
        })

        it('skips reissue gracefully (still 200) when no matching subscription row is found', async () => {
            const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
            issueLicenseForCheckout.mockReset()

            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_renew_orphan',
                type: 'invoice.paid',
                data: {
                    object: { id: 'in_orphan', subscription: 'sub_orphan', billing_reason: 'subscription_cycle' },
                },
            })
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/UPDATE user_subscriptions SET status = 'active'/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SELECT user_id, tier, billing_period FROM user_subscriptions/.test(sql)) return { get: vi.fn(() => undefined) }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(issueLicenseForCheckout).not.toHaveBeenCalled()
        })
    })

    describe('refunds, disputes and the billing hold', () => {
        // Wire a charge -> invoice -> subscription chain so the handler can
        // resolve which subscription a refund or dispute belongs to.
        function wireChargeChain({ subscriptionId = 'sub_ref' } = {}) {
            mockStripeInstance.charges.retrieve.mockResolvedValue({ id: 'ch_1', invoice: 'in_1' })
            mockStripeInstance.invoices.retrieve.mockResolvedValue({ id: 'in_1', subscription: subscriptionId })
        }

        it('leaves a paying customer alone on a PARTIAL refund', async () => {
            // Stripe sends charge.refunded for partial refunds too, with
            // refunded:false. A $5 goodwill credit on a $19 invoice must not
            // strip the tier off a customer who is still fully paid up.
            //
            // The charge chain is wired deliberately: without it the handler
            // would bail out at "no subscription" and this test would pass
            // even with the partial-refund guard removed.
            wireChargeChain()
            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_partial',
                type: 'charge.refunded',
                data: { object: { id: 'ch_partial', invoice: 'in_1', amount: 1900, amount_refunded: 500, refunded: false } },
            })
            const downgrade = vi.fn(() => ({ changes: 1 }))
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SET tier = 'free', status = \?/.test(sql)) return { run: downgrade }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(downgrade).not.toHaveBeenCalled()
        })

        it('downgrades on a FULL refund', async () => {
            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_full',
                type: 'charge.refunded',
                data: { object: { id: 'ch_full', invoice: 'in_1', amount: 1900, amount_refunded: 1900, refunded: true } },
            })
            wireChargeChain()
            const downgrade = vi.fn(() => ({ changes: 1 }))
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SET tier = 'free', status = \?/.test(sql)) return { run: downgrade }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(downgrade).toHaveBeenCalledWith('refunded', 'sub_ref')
        })

        it('does not let customer.subscription.updated lift a refund hold', async () => {
            // Opening the billing portal is enough to emit this event, and
            // Stripe still reports the subscription as active — the refund
            // must not be undone by it.
            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_upd',
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: 'sub_ref',
                        status: 'active',
                        metadata: { tier: 'pro' },
                        current_period_start: 1750000000,
                        current_period_end: 1752000000,
                    },
                },
            })
            const restoreTier = vi.fn(() => ({ changes: 1 }))
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/SELECT status FROM user_subscriptions/.test(sql)) return { get: vi.fn(() => ({ status: 'refunded' })) }
                if (/SET\s+tier = \?, status = \?/.test(sql)) return { run: restoreTier }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(restoreTier).not.toHaveBeenCalled()
        })

        it('restores access when a dispute closes as won', async () => {
            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_won',
                type: 'charge.dispute.closed',
                data: { object: { id: 'dp_1', charge: 'ch_1', status: 'won' } },
            })
            wireChargeChain({ subscriptionId: 'sub_won' })
            mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
                id: 'sub_won', status: 'active', metadata: { tier: 'pro' },
            })
            const restore = vi.fn(() => ({ changes: 1 }))
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/status = 'disputed'/.test(sql)) return { run: restore }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(restore).toHaveBeenCalledWith('pro', 'active', 'sub_won')
        })

        it('leaves the hold in place when a dispute closes as lost', async () => {
            mockStripeInstance.webhooks.constructEvent.mockReturnValue({
                id: 'evt_lost',
                type: 'charge.dispute.closed',
                data: { object: { id: 'dp_2', charge: 'ch_2', status: 'lost' } },
            })
            const restore = vi.fn(() => ({ changes: 1 }))
            mockPrepare.mockImplementation((sql) => {
                if (/INSERT OR IGNORE INTO webhook_events/.test(sql)) return { run: vi.fn(() => ({ changes: 1 })) }
                if (/status = 'disputed'/.test(sql)) return { run: restore }
                return { get: vi.fn(), run: vi.fn(() => ({ changes: 1 })), all: vi.fn(() => []) }
            })

            const { req, res } = makeReqRes({ headers: { 'stripe-signature': 'sig' } })
            await stripeWebhookHandler(req, res)

            expect(res.statusCode).toBe(200)
            expect(restore).not.toHaveBeenCalled()
        })
    })
})
