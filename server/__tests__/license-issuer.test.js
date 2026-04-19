// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks — must stay at module scope (Vitest hoisting requirement)
// ---------------------------------------------------------------------------

const mockPrepare = vi.fn()

vi.mock('../db.js', () => ({
    default: { prepare: mockPrepare },
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

vi.mock('../lib/license.js', () => ({
    generateLicenseKey: vi.fn(),
}))

vi.mock('../lib/email.js', () => ({
    sendEmail: vi.fn(),
    isEmailDeliveryConfigured: vi.fn(() => false),
}))

// Import after mocks
import logger from '../lib/logger.js'
import { generateLicenseKey } from '../lib/license.js'
import { sendEmail } from '../lib/email.js'

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
})
