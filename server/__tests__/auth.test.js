// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock config so we can control nodeEnv per test
vi.mock('../config.js', () => {
    const cfg = { nodeEnv: 'development' }
    return { config: cfg, default: cfg, __mockConfig: cfg }
})

import { __mockConfig as mockConfig } from '../config.js'
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
        mockConfig.nodeEnv = 'development'
        expect(safeError(new Error('db crashed'))).toBe('db crashed')
    })

    it('returns fallback in production', () => {
        mockConfig.nodeEnv = 'production'
        expect(safeError(new Error('db crashed'))).toBe('An internal error occurred')
    })

    it('returns custom fallback', () => {
        mockConfig.nodeEnv = 'production'
        expect(safeError(new Error('x'), 'Something went wrong')).toBe('Something went wrong')
    })

    it('handles null/undefined error', () => {
        mockConfig.nodeEnv = 'development'
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
        const req = { headers: {}, session: { accessToken: 'ghp_xxx' } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        requireAuth(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('returns 401 when no accessToken', () => {
        const req = { headers: {}, session: {} }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        requireAuth(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(401)
    })
})

describe('createRequireAI middleware (BYOK-aware)', () => {
    // Phase Z.2: createRequireAI now resolves the provider via req.getAIProvider
    // rather than hard-checking GEMINI_API_KEY. Tests verify the new contract.

    it('returns 400 AI_NOT_CONFIGURED when no provider is available', async () => {
        const middleware = createRequireAI({})
        // req has no aiProvider and no getAIProvider — no config, no env
        const req = { session: { userId: 1 } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        await middleware(req, res, next)
        expect(res.status).toHaveBeenCalledWith(400)
        const body = res.json.mock.calls[0][0]
        expect(body.error).toBe('AI_NOT_CONFIGURED')
        expect(body.configureUrl).toBe('/settings#ai')
        expect(next).not.toHaveBeenCalled()
    })

    it('returns 400 when getAIProvider resolves null', async () => {
        const middleware = createRequireAI({})
        const req = {
            session: { userId: 1 },
            getAIProvider: vi.fn().mockResolvedValue(null),
        }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        await middleware(req, res, next)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(next).not.toHaveBeenCalled()
    })

    it('calls next when req.aiProvider is pre-populated (by attachAIProvider)', async () => {
        const genAI = { getGenerativeModel: vi.fn() }
        const provider = { name: 'gemini', rawSDK: genAI, generate: vi.fn() }
        const middleware = createRequireAI({})
        const req = { session: { userId: 1 }, aiProvider: provider, genAI }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('calls next and sets req.aiProvider via getAIProvider when not pre-populated', async () => {
        const genAI = { getGenerativeModel: vi.fn() }
        const provider = { name: 'gemini', rawSDK: genAI, generate: vi.fn() }
        const middleware = createRequireAI({})
        const req = {
            session: { userId: 1 },
            getAIProvider: vi.fn().mockResolvedValue(provider),
        }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(req.aiProvider).toBe(provider)
        expect(req.genAI).toBe(genAI) // rawSDK shimmed to genAI
    })

    it('accepts legacy aiService argument without errors (backward compat)', async () => {
        const provider = { name: 'gemini', rawSDK: { stub: true } }
        const middleware = createRequireAI({ genAI: { old: true } }) // legacy arg ignored
        const req = {
            session: { userId: 1 },
            getAIProvider: vi.fn().mockResolvedValue(provider),
        }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        await middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })
})
