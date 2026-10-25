// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks — must stay at module scope (Vitest hoisting requirement)
// ---------------------------------------------------------------------------

const mockPrepare = vi.fn()

vi.mock('../db.js', () => ({
    default: { prepare: mockPrepare, transaction: (fn) => (...args) => fn(...args) },
}))

vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
    },
}))

vi.mock('../lib/license.js', async (importOriginal) => ({
    ...(await importOriginal()),
    generateLicenseKey: vi.fn(),
}))

vi.mock('../lib/email.js', () => ({
    sendEmail: vi.fn(),
    isEmailDeliveryConfigured: vi.fn(() => false),
}))

// Import after mocks
import logger from '../lib/logger.js'
import { generateLicenseKey } from '../lib/license.js'
import { isEmailDeliveryConfigured, sendEmail } from '../lib/email.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStmt({ get = undefined, run = { changes: 1 } } = {}) {
    return {
        get: vi.fn(() => get),
        run: vi.fn(() => run),
        all: vi.fn(() => []),
    }
}

function setupDb(entries) {
    mockPrepare.mockImplementation((sql) => {
        const match = entries.find(([pattern]) =>
            pattern instanceof RegExp ? pattern.test(sql) : sql.includes(pattern)
        )
        if (match) return match[1]
        return makeStmt()
    })
}

const OPTS = {
    userId: 42,
    email: 'user@example.com',
    tier: 'pro',
    seats: 5,
    months: 12,
    stripeSubscriptionId: 'sub_test_1',
    stripeSessionId: 'cs_test_1',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issueLicenseForCheckout', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        mockPrepare.mockReset()
        vi.mocked(generateLicenseKey).mockReset()
        vi.mocked(sendEmail).mockReset()
        vi.mocked(isEmailDeliveryConfigured).mockReturnValue(true)
        vi.mocked(logger.warn).mockClear()
        vi.mocked(logger.error).mockClear()
        vi.mocked(logger.fatal).mockClear()
        process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = 'FAKE_PEM'
        process.env.NODE_ENV = 'test'
    })

    afterEach(() => {
        // Restore env
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key]
        }
        Object.assign(process.env, originalEnv)
    })

    it('valid opts → license generated, persisted, and email dispatched', async () => {
        const licenseKey = 'grm_lic_testkey123'
        vi.mocked(generateLicenseKey).mockResolvedValue(licenseKey)
        vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: 'email_id_1' })

        const existingStmt = makeStmt({ get: undefined })
        const insertStmt = makeStmt()
        const updateStmt = makeStmt()

        setupDb([
            [/SELECT license_key/, existingStmt],
            [/INSERT OR IGNORE INTO issued_licenses/, insertStmt],
            [/UPDATE issued_licenses/, updateStmt],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        const result = await issueLicenseForCheckout(OPTS)

        expect(result.licenseKey).toBe(licenseKey)
        expect(result.emailDelivered).toBe(true)
        expect(generateLicenseKey).toHaveBeenCalledWith(
            expect.objectContaining({ email: OPTS.email, tier: OPTS.tier }),
            'FAKE_PEM'
        )
        expect(sendEmail).toHaveBeenCalledOnce()
        expect(sendEmail.mock.calls[0][0].to).toBe(OPTS.email)
        expect(insertStmt.run).toHaveBeenCalledOnce()
        expect(updateStmt.run).toHaveBeenCalledOnce()
    })

    it('email delivery not configured → key persisted, nothing sent, row not marked delivered', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue('grm_lic_unconfigured')
        vi.mocked(isEmailDeliveryConfigured).mockReturnValue(false)

        const insertStmt = makeStmt()
        const updateStmt = makeStmt()
        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
            [/INSERT OR IGNORE INTO issued_licenses/, insertStmt],
            [/UPDATE issued_licenses/, updateStmt],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        const result = await issueLicenseForCheckout(OPTS)

        expect(result.licenseKey).toBe('grm_lic_unconfigured')
        expect(result.emailDelivered).toBe(false)
        expect(result.emailConfigured).toBe(false)
        expect(sendEmail).not.toHaveBeenCalled()
        expect(insertStmt.run).toHaveBeenCalledOnce()
        // The console adapter would have answered ok; the row must stay undelivered.
        expect(updateStmt.run).not.toHaveBeenCalled()
    })

    it('duplicate stripe_session_id → idempotent return, no second email', async () => {
        const existingRow = { license_key: 'grm_lic_existing', email_delivered: 1 }
        setupDb([
            [/SELECT license_key/, makeStmt({ get: existingRow })],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        const result = await issueLicenseForCheckout(OPTS)

        expect(result.licenseKey).toBe('grm_lic_existing')
        expect(result.emailDelivered).toBe(true)
        expect(generateLicenseKey).not.toHaveBeenCalled()
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('missing signing key in dev → returns { licenseKey: null, emailDelivered: false } gracefully', async () => {
        delete process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM
        // NODE_ENV stays 'test' (non-production)

        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        const result = await issueLicenseForCheckout(OPTS)

        expect(result).toEqual({ licenseKey: null, emailDelivered: false })
        expect(generateLicenseKey).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalled()
        expect(logger.fatal).not.toHaveBeenCalled()
    })

    it('missing signing key in production → logs fatal, returns null, does not throw', async () => {
        delete process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM
        process.env.NODE_ENV = 'production'

        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')

        // Should not throw
        let result
        await expect(async () => {
            result = await issueLicenseForCheckout(OPTS)
        }).not.toThrow()

        expect(result).toEqual({ licenseKey: null, emailDelivered: false })
        expect(logger.fatal).toHaveBeenCalled()
    })

    it('email send failure → license still persisted; emailDelivered = false', async () => {
        const licenseKey = 'grm_lic_failmail'
        vi.mocked(generateLicenseKey).mockResolvedValue(licenseKey)
        vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: 'Resend 500' })

        const insertStmt = makeStmt()
        const updateStmt = makeStmt()

        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
            [/INSERT OR IGNORE INTO issued_licenses/, insertStmt],
            [/UPDATE issued_licenses/, updateStmt],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        const result = await issueLicenseForCheckout(OPTS)

        expect(result.licenseKey).toBe(licenseKey)
        expect(result.emailDelivered).toBe(false)
        // License was still persisted
        expect(insertStmt.run).toHaveBeenCalledOnce()
        // email_delivered UPDATE was NOT issued
        expect(updateStmt.run).not.toHaveBeenCalled()
    })

    it('email sent with subject containing the tier plan name', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue('grm_lic_key')
        vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: 'eid' })

        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
            [/INSERT OR IGNORE INTO issued_licenses/, makeStmt()],
            [/UPDATE issued_licenses/, makeStmt()],
        ])

        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await issueLicenseForCheckout({ ...OPTS, tier: 'enterprise' })

        const [{ subject }] = sendEmail.mock.calls[0]
        expect(subject).toMatch(/enterprise/i)
        expect(subject).toMatch(/license/i)
    })

    it('sends on the licences stream and queues a reference, never the key', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue('grm_lic_key')
        vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: 'eid' })

        setupDb([
            [/SELECT license_key/, makeStmt({ get: undefined })],
            [/INSERT OR IGNORE INTO issued_licenses/, makeStmt()],
            [/UPDATE issued_licenses/, makeStmt()],
        ])

        const { issueLicenseForCheckout, LICENSE_EMAIL_KIND } = await import('../lib/license-issuer.js')
        await issueLicenseForCheckout({ ...OPTS, months: 12 })

        const [args] = sendEmail.mock.calls[0]
        expect(args.stream).toBe('licences')
        expect(args.deadLetter).toBe('rebuild')
        expect(args.idempotencyKey).toBe(`license-${OPTS.stripeSessionId}`)
        expect(args.context).toEqual({
            kind: LICENSE_EMAIL_KIND,
            stripeSessionId: OPTS.stripeSessionId,
            tier: OPTS.tier,
            months: 12,
            renewal: false,
        })
        expect(JSON.stringify(args.context)).not.toContain('grm_lic_key')
        expect(args.text).not.toContain('bruno@bolalabs.pt')
    })

    it('dead-letter handler rebuilds the email from issued_licenses and records delivery', async () => {
        const updateStmt = makeStmt()
        setupDb([
            [/SELECT license_key, tier, expires_at, billing_period FROM issued_licenses/, makeStmt({ get: { license_key: 'grm_lic_stored', tier: 'pro' } })],
            [/UPDATE issued_licenses/, updateStmt],
        ])

        const { licenseEmailDeadLetterHandler } = await import('../lib/license-issuer.js')
        const rebuilt = licenseEmailDeadLetterHandler.rebuild({ stripeSessionId: 'cs_9', tier: 'pro', months: 1 })
        expect(rebuilt.text).toContain('grm_lic_stored')
        expect(rebuilt.html).toContain('grm_lic_stored')
        expect(rebuilt.subject).toMatch(/pro plan/)

        licenseEmailDeadLetterHandler.onDelivered({ stripeSessionId: 'cs_9' })
        expect(updateStmt.run).toHaveBeenCalledWith('cs_9')
    })

    it('dead-letter handler returns null when the licence row is gone', async () => {
        setupDb([[/SELECT license_key, tier, expires_at, billing_period FROM issued_licenses/, makeStmt({ get: undefined })]])
        const { licenseEmailDeadLetterHandler } = await import('../lib/license-issuer.js')
        expect(licenseEmailDeadLetterHandler.rebuild({ stripeSessionId: 'cs_missing' })).toBeNull()
        expect(licenseEmailDeadLetterHandler.rebuild({})).toBeNull()
    })
})

// A JWT-shaped key whose payload carries a lid, so the issuer can store it.
function fakeKey(lid) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `grm_lic_${b64({ alg: 'EdDSA' })}.${b64({ lid, tier: 'pro' })}.sig`
}

describe('licence expiry and org', () => {
    const originalGrace = process.env.LICENSE_GRACE_DAYS
    afterEach(() => {
        if (originalGrace === undefined) delete process.env.LICENSE_GRACE_DAYS
        else process.env.LICENSE_GRACE_DAYS = originalGrace
    })

    it('a key outlives its paid period by the grace, so the renewal key exists first', async () => {
        const { licenseExpiry } = await import('../lib/license-issuer.js')
        const now = 1_800_000_000
        const periodEnd = now + 30 * 86400
        expect(licenseExpiry({ periodEnd, months: 1, now })).toBe(periodEnd + 7 * 86400)
        process.env.LICENSE_GRACE_DAYS = '3'
        expect(licenseExpiry({ periodEnd, months: 1, now })).toBe(periodEnd + 3 * 86400)
        process.env.LICENSE_GRACE_DAYS = '999'
        expect(licenseExpiry({ periodEnd, months: 1, now })).toBe(periodEnd + 7 * 86400)
    })

    it('without a period end it falls back to calendar months from now', async () => {
        const { licenseExpiry } = await import('../lib/license-issuer.js')
        const { addCalendarMonths } = await import('../lib/license.js')
        const now = 1_800_000_000
        expect(licenseExpiry({ periodEnd: null, months: 12, now })).toBe(addCalendarMonths(now, 12))
        expect(licenseExpiry({ periodEnd: now - 10, months: 1, now })).toBe(addCalendarMonths(now, 1))
    })

    it('org: business name, then customer name, then a company domain, never a free-mail domain', async () => {
        const { resolveLicenseOrg } = await import('../lib/license-issuer.js')
        expect(resolveLicenseOrg({ businessName: ' Acme,\nLda ', customerName: 'Jo', email: 'a@acme.pt' })).toBe('Acme, Lda')
        expect(resolveLicenseOrg({ customerName: 'Joana Silva', email: 'j@gmail.com' })).toBe('Joana Silva')
        expect(resolveLicenseOrg({ email: 'dev@acme.pt' })).toBe('acme.pt')
        expect(resolveLicenseOrg({ email: 'dev@gmail.com' })).toBe('dev@gmail.com')
        expect(resolveLicenseOrg({})).toBeNull()
    })
})

describe('issuing with a period end', () => {
    beforeEach(() => {
        mockPrepare.mockReset()
        vi.mocked(generateLicenseKey).mockReset()
        vi.mocked(sendEmail).mockReset().mockResolvedValue({ ok: true, id: 'e' })
        vi.mocked(isEmailDeliveryConfigured).mockReturnValue(true)
        process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = 'FAKE_PEM'
        delete process.env.LICENSE_GRACE_DAYS
    })

    it('signs exp = period end + grace with the org, and stores lid, org and period', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue(fakeKey('lid-123'))
        const insert = makeStmt()
        setupDb([[/SELECT license_key/, makeStmt()], [/INSERT OR IGNORE INTO issued_licenses/, insert]])
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await issueLicenseForCheckout({ ...OPTS, months: 1, periodEnd, org: 'Acme, Lda', billingPeriod: 'monthly' })

        expect(generateLicenseKey).toHaveBeenCalledWith(
            expect.objectContaining({ org: 'Acme, Lda', expiresAt: periodEnd + 7 * 86400 }),
            'FAKE_PEM'
        )
        const args = insert.run.mock.calls[0]
        expect(args).toContain('lid-123')
        expect(args).toContain('Acme, Lda')
        expect(args).toContain('monthly')
        expect(args).toContain(new Date(periodEnd * 1000).toISOString())
        expect(args).toContain(new Date((periodEnd + 7 * 86400) * 1000).toISOString())
    })

    it('a signing failure throws so Stripe retries, instead of answering 200 for a key that does not exist', async () => {
        vi.mocked(generateLicenseKey).mockRejectedValue(new Error('bad pem'))
        setupDb([[/SELECT license_key/, makeStmt()]])
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await expect(issueLicenseForCheckout(OPTS)).rejects.toThrow(/generation failed/)
    })

    it('a persistence failure throws too', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue(fakeKey('lid-x'))
        const insert = makeStmt()
        insert.run.mockImplementation(() => { throw new Error('disk full') })
        setupDb([[/SELECT license_key/, makeStmt()], [/INSERT OR IGNORE INTO issued_licenses/, insert]])
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await expect(issueLicenseForCheckout(OPTS)).rejects.toThrow(/persistence failed/)
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('the email names the real end date and never promises self-hosters "no action needed"', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue(fakeKey('lid-m'))
        setupDb([[/SELECT license_key/, makeStmt()], [/INSERT OR IGNORE INTO issued_licenses/, makeStmt()]])
        const periodEnd = Date.UTC(2031, 0, 10) / 1000
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await issueLicenseForCheckout({ ...OPTS, months: 1, periodEnd, billingPeriod: 'monthly' })
        const [mail] = sendEmail.mock.calls[0]
        expect(mail.text).toContain('valid until 2031-01-17')
        expect(mail.text).toMatch(/paste each new key under Settings/)
        expect(mail.text.toLowerCase()).not.toContain('no action needed')
        expect(mail.subject).not.toMatch(/renewed/)
    })

    it('a renewal says so instead of thanking the customer for subscribing again', async () => {
        vi.mocked(generateLicenseKey).mockResolvedValue(fakeKey('lid-r'))
        setupDb([[/SELECT license_key/, makeStmt()], [/INSERT OR IGNORE INTO issued_licenses/, makeStmt()]])
        const { issueLicenseForCheckout } = await import('../lib/license-issuer.js')
        await issueLicenseForCheckout({ ...OPTS, renewal: true, stripeSessionId: 'in_1' })
        const [mail] = sendEmail.mock.calls[0]
        expect(mail.subject).toMatch(/renewed/)
        expect(mail.text).not.toContain('Thank you for subscribing')
        expect(mail.context.renewal).toBe(true)
    })
})

describe('revokeSubscriptionLicenses', () => {
    it('revokes every live key of the subscription and marks the rows', async () => {
        mockPrepare.mockReset()
        const select = makeStmt()
        select.all.mockReturnValue([
            { lid: 'a', org: 'Acme', tier: 'pro', expires_at: '2031-01-01T00:00:00.000Z' },
            { lid: 'b', org: 'Acme', tier: 'pro', expires_at: '2031-02-01T00:00:00.000Z' },
        ])
        const revoke = makeStmt()
        const mark = makeStmt()
        setupDb([
            [/SELECT lid, org, tier, expires_at FROM issued_licenses/, select],
            [/INSERT INTO revoked_licenses/, revoke],
            [/UPDATE issued_licenses SET revoked_at/, mark],
        ])
        const { revokeSubscriptionLicenses } = await import('../lib/license-issuer.js')
        expect(revokeSubscriptionLicenses('sub_1', 'refund')).toBe(2)
        expect(select.all).toHaveBeenCalledWith('sub_1')
        expect(revoke.run).toHaveBeenCalledTimes(2)
        expect(revoke.run.mock.calls[0][0]).toMatchObject({ lid: 'a', reason: 'refund', org: 'Acme' })
        expect(mark.run).toHaveBeenCalledWith('refund', 'b')
    })
})
