// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    isValidGitHubUsername,
    verifyWebhookSignature,
    safeError,
    errorResponse,
    requireAuth,
    createRequireAI
} from '../middleware/auth.js'

describe('isValidGitHubUsername', () => {
    it('accepts valid usernames', () => {
        expect(isValidGitHubUsername('octocat')).toBe(true)
        expect(isValidGitHubUsername('user-name')).toBe(true)
        expect(isValidGitHubUsername('user123')).toBe(true)
        expect(isValidGitHubUsername('a')).toBe(true)
    })

    it('rejects invalid usernames', () => {
        expect(isValidGitHubUsername('')).toBe(false)
        expect(isValidGitHubUsername(null)).toBe(false)
        expect(isValidGitHubUsername(undefined)).toBe(false)
        expect(isValidGitHubUsername(123)).toBe(false)
        expect(isValidGitHubUsername('-invalid')).toBe(false)
        expect(isValidGitHubUsername('user--name')).toBe(false)
        expect(isValidGitHubUsername('user_name')).toBe(false) // underscores not allowed
        expect(isValidGitHubUsername('a'.repeat(40))).toBe(false) // too long
    })

    it('rejects usernames with special characters', () => {
        expect(isValidGitHubUsername('user@name')).toBe(false)
        expect(isValidGitHubUsername('user name')).toBe(false)
        expect(isValidGitHubUsername('user.name')).toBe(false)
    })
})

describe('verifyWebhookSignature', () => {
    const originalEnv = process.env.WEBHOOK_SECRET

    afterEach(() => {
        process.env.WEBHOOK_SECRET = originalEnv
    })

    it('returns false when no secret configured', () => {
        delete process.env.WEBHOOK_SECRET
        expect(verifyWebhookSignature('payload', 'sha256=abc')).toBe(false)
    })

    it('returns false when no signature provided', () => {
        process.env.WEBHOOK_SECRET = 'test-secret'
        expect(verifyWebhookSignature('payload', null)).toBe(false)
        expect(verifyWebhookSignature('payload', '')).toBe(false)
    })

    it('verifies valid signature', () => {
        process.env.WEBHOOK_SECRET = 'test-secret'
        const crypto = require('crypto')
        const payload = '{"action":"push"}'
        const expected = 'sha256=' + crypto.createHmac('sha256', 'test-secret')
            .update(payload).digest('hex')
        expect(verifyWebhookSignature(payload, expected)).toBe(true)
    })

    it('rejects invalid signature', () => {
        process.env.WEBHOOK_SECRET = 'test-secret'
        expect(verifyWebhookSignature('payload', 'sha256=invalid')).toBe(false)
    })

    it('handles object payloads by stringifying', () => {
        process.env.WEBHOOK_SECRET = 'test-secret'
        const crypto = require('crypto')
        const obj = { action: 'push' }
        const expected = 'sha256=' + crypto.createHmac('sha256', 'test-secret')
            .update(JSON.stringify(obj)).digest('hex')
        expect(verifyWebhookSignature(obj, expected)).toBe(true)
    })
})

describe('safeError', () => {
    const originalEnv = process.env.NODE_ENV

    afterEach(() => {
        process.env.NODE_ENV = originalEnv
    })

    it('returns error message in development', () => {
        process.env.NODE_ENV = 'development'
        expect(safeError(new Error('db crashed'))).toBe('db crashed')
    })

    it('returns fallback in production', () => {
        process.env.NODE_ENV = 'production'
        expect(safeError(new Error('db crashed'))).toBe('An internal error occurred')
    })

    it('returns custom fallback', () => {
        process.env.NODE_ENV = 'production'
        expect(safeError(new Error('x'), 'Something went wrong')).toBe('Something went wrong')
    })

    it('handles null/undefined error', () => {
        process.env.NODE_ENV = 'development'
        expect(safeError(null)).toBe('An internal error occurred')
        expect(safeError(undefined)).toBe('An internal error occurred')
    })
})

describe('errorResponse', () => {
    it('sends JSON error with status code', () => {
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        }
        errorResponse(res, 400, 'Bad request')
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'Bad request' })
    })

    it('includes code when provided', () => {
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        }
        errorResponse(res, 403, 'Forbidden', 'FORBIDDEN')
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden', code: 'FORBIDDEN' })
    })

    it('omits code when null', () => {
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        }
        errorResponse(res, 500, 'Server error', null)
        const jsonArg = res.json.mock.calls[0][0]
        expect(jsonArg).not.toHaveProperty('code')
    })
})

describe('requireAuth middleware', () => {
    it('calls next when session has accessToken', () => {
        const req = { session: { accessToken: 'ghp_xxx' } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        requireAuth(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('returns 401 when no accessToken', () => {
        const req = { session: {} }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        requireAuth(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(401)
    })
})

describe('createRequireAI middleware', () => {
    const originalEnv = process.env.GEMINI_API_KEY

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.GEMINI_API_KEY = originalEnv
        } else {
            delete process.env.GEMINI_API_KEY
        }
    })

    it('returns 503 when GEMINI_API_KEY not set', () => {
        delete process.env.GEMINI_API_KEY
        const middleware = createRequireAI({ genAI: true })
        const req = {}
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        expect(res.status).toHaveBeenCalledWith(503)
        expect(next).not.toHaveBeenCalled()
    })

    it('returns 503 when aiService.genAI is falsy', () => {
        process.env.GEMINI_API_KEY = 'test-key'
        const middleware = createRequireAI({ genAI: null })
        const req = {}
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        expect(res.status).toHaveBeenCalledWith(503)
    })

    it('calls next and sets req.genAI when configured', () => {
        process.env.GEMINI_API_KEY = 'test-key'
        const genAI = { generateContent: vi.fn() }
        const middleware = createRequireAI({ genAI })
        const req = {}
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(req.genAI).toBe(genAI)
    })
})
