// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// We import sendEmail and isEmailDeliveryConfigured after mocks are set up.
// We re-import inside each test that changes process.env so the module cache
// doesn't interfere with env-dependent branches.

describe('email service', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        // Reset env to a clean state before each test
        delete process.env.EMAIL_PROVIDER
        delete process.env.RESEND_API_KEY
        delete process.env.EMAIL_FROM
        vi.resetModules()
    })

    afterEach(() => {
        // Restore original env
        Object.assign(process.env, originalEnv)
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key]
        }
        vi.restoreAllMocks()
    })

    // -------------------------------------------------------------------------
    // Console adapter
    // -------------------------------------------------------------------------

    it('console adapter: returns { ok: true } without throwing', async () => {
        process.env.EMAIL_PROVIDER = 'console'
        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'Test',
            html: '<p>Hello</p>',
        })
        expect(result).toEqual({ ok: true })
    })

    it('console adapter: default provider is console when EMAIL_PROVIDER is unset', async () => {
        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'Default',
            html: '<p>Hi</p>',
        })
        expect(result).toEqual({ ok: true })
    })

    // -------------------------------------------------------------------------
    // Resend adapter (happy path)
    // -------------------------------------------------------------------------

    it('resend adapter: POSTs to Resend API with correct body and auth header', async () => {
        process.env.EMAIL_PROVIDER = 'resend'
        process.env.RESEND_API_KEY = 'test_key_abc'
        process.env.EMAIL_FROM = 'noreply@bolalabs.pt'

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'email_id_123' }),
        })
        vi.stubGlobal('fetch', mockFetch)

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'customer@example.com',
            subject: 'Your license',
            html: '<p>Here is your key</p>',
        })

        expect(result).toEqual({ ok: true, id: 'email_id_123' })

        expect(mockFetch).toHaveBeenCalledOnce()
        const [url, init] = mockFetch.mock.calls[0]
        expect(url).toBe('https://api.resend.com/emails')
        expect(init.method).toBe('POST')
        expect(init.headers['Authorization']).toBe('Bearer test_key_abc')
        expect(init.headers['Content-Type']).toBe('application/json')

        const body = JSON.parse(init.body)
        expect(body.from).toBe('noreply@bolalabs.pt')
        expect(body.to).toBe('customer@example.com')
        expect(body.subject).toBe('Your license')
        expect(body.html).toBe('<p>Here is your key</p>')
        // text fallback should be auto-derived
        expect(typeof body.text).toBe('string')
        expect(body.text.length).toBeGreaterThan(0)
    })

    it('resend adapter: returns id from Resend response', async () => {
        process.env.EMAIL_PROVIDER = 'resend'
        process.env.RESEND_API_KEY = 'key'
        process.env.EMAIL_FROM = 'from@test.com'

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'resend_abc_xyz' }),
        }))

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>X</p>' })
        expect(result.ok).toBe(true)
        expect(result.id).toBe('resend_abc_xyz')
    })

    // -------------------------------------------------------------------------
    // Resend adapter (error paths)
    // -------------------------------------------------------------------------

    it('resend adapter: 4xx → returns { ok: false, error } without throwing', async () => {
        process.env.EMAIL_PROVIDER = 'resend'
        process.env.RESEND_API_KEY = 'bad_key'
        process.env.EMAIL_FROM = 'from@test.com'

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 422,
            statusText: 'Unprocessable Entity',
            json: async () => ({ message: 'Invalid email address' }),
        }))

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({ to: 'user@example.com', subject: 'S', html: '<p>X</p>' })
        expect(result.ok).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.error).toBeTruthy()
    })

    it('resend adapter: 5xx → returns { ok: false, error } without throwing', async () => {
        process.env.EMAIL_PROVIDER = 'resend'
        process.env.RESEND_API_KEY = 'key'
        process.env.EMAIL_FROM = 'from@test.com'

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ message: 'upstream error' }),
        }))

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({ to: 'user@example.com', subject: 'S', html: '<p>X</p>' })
        expect(result.ok).toBe(false)
        expect(result.error).toBeTruthy()
    })

    // -------------------------------------------------------------------------
    // Input validation
    // -------------------------------------------------------------------------

    it('invalid to address → returns { ok: false, error: "invalid recipient" }', async () => {
        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({ to: 'not-an-email', subject: 'Test', html: '<p>Hi</p>' })
        expect(result).toEqual({ ok: false, error: 'invalid recipient' })
    })

    it('missing to → returns { ok: false, error: "invalid recipient" }', async () => {
        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({ to: '', subject: 'Test', html: '<p>Hi</p>' })
        expect(result).toEqual({ ok: false, error: 'invalid recipient' })
    })

    // -------------------------------------------------------------------------
    // isEmailDeliveryConfigured
    // -------------------------------------------------------------------------

    it('isEmailDeliveryConfigured: returns true when EMAIL_PROVIDER=resend', async () => {
        process.env.EMAIL_PROVIDER = 'resend'
        const { isEmailDeliveryConfigured } = await import('../lib/email.js')
        expect(isEmailDeliveryConfigured()).toBe(true)
    })

    it('isEmailDeliveryConfigured: returns false when EMAIL_PROVIDER=console', async () => {
        process.env.EMAIL_PROVIDER = 'console'
        const { isEmailDeliveryConfigured } = await import('../lib/email.js')
        expect(isEmailDeliveryConfigured()).toBe(false)
    })

    it('isEmailDeliveryConfigured: returns false when EMAIL_PROVIDER is unset', async () => {
        const { isEmailDeliveryConfigured } = await import('../lib/email.js')
        expect(isEmailDeliveryConfigured()).toBe(false)
    })
})
