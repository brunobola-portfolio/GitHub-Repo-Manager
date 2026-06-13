// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import express from 'express'
import session from 'express-session'
import request from 'supertest'

// Mock config so we can control nodeEnv per test
vi.mock('../config.js', () => {
    const cfg = { nodeEnv: 'development' }
    return { config: cfg, default: cfg, __mockConfig: cfg }
})

// Mocks needed by routes/auth.js (OAuth callback fail-closed tests below).
// The fail-closed paths return before any DB write, so a no-op db is enough.
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
    },
}))
vi.mock('../lib/audit.js', () => ({ auditLog: () => {} }))
vi.mock('../middleware/tenant-rate-limit.js', () => ({
    // Passthrough — rate limiting isn't exercised here.
    createAuthRouteLimiter: () => (_req, _res, next) => next(),
}))

import { __mockConfig as mockConfig } from '../config.js'
import {
    isValidGitHubUsername,
    verifyWebhookSignature,
    safeError,
    errorResponse,
    requireAuth,
    createRequireAI
} from '../middleware/auth.js'
import authRouter from '../routes/auth.js'

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

    it('returns true when WEBHOOK_SECRET unset in non-production (dev friction tradeoff)', () => {
        delete process.env.WEBHOOK_SECRET
        const savedEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'development'
        expect(verifyWebhookSignature('payload', 'sha256=abc')).toBe(true)
        process.env.NODE_ENV = savedEnv
    })

    it('returns false when WEBHOOK_SECRET unset in production', () => {
        delete process.env.WEBHOOK_SECRET
        const savedEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        expect(verifyWebhookSignature('payload', 'sha256=abc')).toBe(false)
        process.env.NODE_ENV = savedEnv
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

    it('handles Buffer payloads (real GitHub deliveries via express.raw)', () => {
        // Express raw body middleware yields a Buffer. Verifier must use the
        // bytes directly — not JSON.stringify the Buffer (which would produce
        // a garbage `{"type":"Buffer","data":[...]}` string).
        process.env.WEBHOOK_SECRET = 'test-secret'
        const crypto = require('crypto')
        const buf = Buffer.from('{"action":"opened","number":42}', 'utf8')
        const expected = 'sha256=' + crypto.createHmac('sha256', 'test-secret')
            .update(buf).digest('hex')
        expect(verifyWebhookSignature(buf, expected)).toBe(true)
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

// ── GitHub OAuth /callback — fail-closed on unidentifiable user ─────────
// routes/auth.js: if the GitHub /user fetch returns !ok, OR returns ok but
// the body has no id, the handler must redirect to
// `${FRONTEND_URL}?error=auth_failed` and must NOT establish an
// authenticated session carrying accessToken. Previously a failed /user
// fetch fell through and saved a session with accessToken but no userId,
// which requireAuth (accessToken-only) treated as logged in.
describe('GitHub OAuth /callback fail-closed', () => {
    const FRONTEND_URL = 'http://localhost:5173'
    const OAUTH_STATE = 'fixed-state-token-for-test'
    const originalFetch = global.fetch
    const savedEnv = {}

    function buildApp() {
        const app = express()
        app.use(express.json())
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: true, // allow the empty session to persist a cookie
            cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
        }))
        // routes/auth.js calls req.log.error(...) on the fail-closed paths.
        app.use((req, _res, next) => {
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        // Seed the OAuth state into the session so /callback's timing-safe
        // state check passes (we can't run the real /login redirect here).
        app.post('/__seed-state', (req, res) => {
            req.session.oauthState = OAUTH_STATE
            req.session.save(() => res.json({ ok: true }))
        })
        app.use('/api/auth', authRouter)
        return app
    }

    beforeEach(() => {
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            savedEnv[k] = process.env[k]
        }
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
        process.env.FRONTEND_URL = FRONTEND_URL
    })

    afterEach(() => {
        global.fetch = originalFetch
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            if (savedEnv[k] === undefined) delete process.env[k]
            else process.env[k] = savedEnv[k]
        }
    })

    // Token exchange succeeds; the subsequent /user fetch returns a JSON body.
    function mockFetch({ userOk, userBody }) {
        global.fetch = vi.fn(async (url) => {
            if (typeof url === 'string' && url.includes('login/oauth/access_token')) {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'ghp_exchanged_token' }),
                }
            }
            // https://api.github.com/user
            return {
                ok: userOk,
                status: userOk ? 200 : 401,
                json: async () => userBody,
            }
        })
    }

    it('(a) /user responds 401/!ok → redirect to error=auth_failed, no session established', async () => {
        mockFetch({ userOk: false, userBody: { message: 'Bad credentials' } })
        const agent = request.agent(buildApp())
        await agent.post('/__seed-state')

        const res = await agent
            .get('/api/auth/callback')
            .query({ code: 'abc123', state: OAUTH_STATE })
        // Redirect must be the auth_failed URL, NOT the success FRONTEND_URL.
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(`${FRONTEND_URL}?error=auth_failed`)
        expect(res.headers.location).not.toBe(FRONTEND_URL)

        // No authenticated session: a follow-up /session must report 401.
        const sessionRes = await agent.get('/api/auth/session')
        expect(sessionRes.status).toBe(401)
        expect(sessionRes.body).toEqual({ authenticated: false })
    })

    it('(b) /user ok but JSON has no id → redirect to error=auth_failed, no session established', async () => {
        mockFetch({ userOk: true, userBody: { login: 'octocat' /* no id */ } })
        const agent = request.agent(buildApp())
        await agent.post('/__seed-state')

        const res = await agent
            .get('/api/auth/callback')
            .query({ code: 'abc123', state: OAUTH_STATE })
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(`${FRONTEND_URL}?error=auth_failed`)
        expect(res.headers.location).not.toBe(FRONTEND_URL)

        const sessionRes = await agent.get('/api/auth/session')
        expect(sessionRes.status).toBe(401)
        expect(sessionRes.body).toEqual({ authenticated: false })
    })

    it('control: /user ok WITH id → redirects to success FRONTEND_URL (sanity check the harness)', async () => {
        mockFetch({ userOk: true, userBody: { id: 12345, login: 'octocat', avatar_url: 'x' } })
        const agent = request.agent(buildApp())
        await agent.post('/__seed-state')

        const res = await agent
            .get('/api/auth/callback')
            .query({ code: 'abc123', state: OAUTH_STATE })
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(FRONTEND_URL)
    })
})
