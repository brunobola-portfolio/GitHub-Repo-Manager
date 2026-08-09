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

// ── /login unconfigured-OAuth guard + same-origin FRONTEND_URL fallback ──
// routes/auth.js: without GITHUB_CLIENT_ID/SECRET, /login must redirect back
// to the app carrying error=oauth_not_configured — never to GitHub with
// client_id=undefined (which strands the user on a GitHub 404). And when
// FRONTEND_URL is unset (packaged/self-host installs where Express serves
// the frontend itself), every redirect must fall back to the request's own
// origin, not the historical hardcoded http://localhost:5173.
describe('GitHub OAuth /login guard + same-origin fallback', () => {
    const savedEnv = {}

    function buildApp() {
        const app = express()
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: true,
            cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
        }))
        app.use('/api/auth', authRouter)
        return app
    }

    beforeEach(() => {
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            savedEnv[k] = process.env[k]
            delete process.env[k]
        }
    })

    afterEach(() => {
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            if (savedEnv[k] === undefined) delete process.env[k]
            else process.env[k] = savedEnv[k]
        }
    })

    it('unconfigured + FRONTEND_URL set → redirects there with error=oauth_not_configured', async () => {
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const res = await request(buildApp()).get('/api/auth/login')
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe('http://localhost:5173/?error=oauth_not_configured')
    })

    it('unconfigured + no FRONTEND_URL → redirects to the request origin (same-origin fallback)', async () => {
        const res = await request(buildApp()).get('/api/auth/login')
        expect(res.status).toBe(302)
        // supertest binds an ephemeral 127.0.0.1 port; the redirect must go
        // back to that exact origin, never to GitHub or localhost:5173.
        expect(res.headers.location).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?error=oauth_not_configured$/)
    })

    it('configured → redirects to GitHub authorize with the real client_id', async () => {
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
        const res = await request(buildApp()).get('/api/auth/login')
        expect(res.status).toBe(302)
        expect(res.headers.location).toContain('https://github.com/login/oauth/authorize')
        expect(res.headers.location).toContain('client_id=test-client-id')
        expect(res.headers.location).not.toContain('client_id=undefined')
    })

    it('client_id set but secret missing → still guards (half-configured cannot complete the flow)', async () => {
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const res = await request(buildApp()).get('/api/auth/login')
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe('http://localhost:5173/?error=oauth_not_configured')
    })

    it('/callback with no code + no FRONTEND_URL → error redirect stays same-origin', async () => {
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
        const res = await request(buildApp()).get('/api/auth/callback')
        expect(res.status).toBe(302)
        expect(res.headers.location).toMatch(/^http:\/\/127\.0\.0\.1:\d+\?error=no_code$/)
    })

    it('/callback forwards GitHub\'s own error code (user cancelled → access_denied)', async () => {
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const res = await request(buildApp())
            .get('/api/auth/callback')
            .query({ error: 'access_denied' })
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe('http://localhost:5173?error=access_denied')
    })

    it('/callback sanitizes a malicious error param instead of reflecting it', async () => {
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const res = await request(buildApp())
            .get('/api/auth/callback')
            .query({ error: '<script>alert(1)</script>' })
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe('http://localhost:5173?error=no_code')
    })
})

// ── redirect_uri origin behind a TLS-terminating reverse proxy ──────────
// routes/auth.js resolveCallbackOrigin: GitHub matches redirect_uri against
// the OAuth App registration exactly, so a proxy that drops X-Forwarded-Proto
// (IIS/ARR does, out of the box) would otherwise produce an http:// URI
// against an https:// registration and break every login on the hosted
// deployment. FRONTEND_URL wins ONLY when it names the same host.
describe('OAuth redirect_uri origin resolution', () => {
    const savedEnv = {}

    function buildApp() {
        const app = express()
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: true,
            // `secure` is omitted, not set to false: supertest speaks plain HTTP,
            // so a Secure cookie would never come back — and the explicit literal
            // is what trips CodeQL's clear-text-cookie rule. Default is false.
            cookie: { httpOnly: true, sameSite: 'lax' },
        }))
        app.use('/api/auth', authRouter)
        return app
    }

    function redirectUriOf(location) {
        return decodeURIComponent(
            new URL(location).searchParams.get('redirect_uri') ?? ''
        )
    }

    beforeEach(() => {
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            savedEnv[k] = process.env[k]
            delete process.env[k]
        }
        process.env.GITHUB_CLIENT_ID = 'test-client-id'
        process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
    })

    afterEach(() => {
        for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL']) {
            if (savedEnv[k] === undefined) delete process.env[k]
            else process.env[k] = savedEnv[k]
        }
    })

    it('same host + https FRONTEND_URL → https redirect_uri even over plain HTTP', async () => {
        process.env.FRONTEND_URL = 'https://repomanager.example.pt'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'repomanager.example.pt')
        expect(res.status).toBe(302)
        expect(redirectUriOf(res.headers.location))
            .toBe('https://repomanager.example.pt/api/auth/callback')
    })

    it('different host (dev: Vite :5173 vs API :3001) → keeps the request origin', async () => {
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'localhost:3001')
        expect(redirectUriOf(res.headers.location))
            .toBe('http://localhost:3001/api/auth/callback')
    })

    it('FRONTEND_URL unset (packaged install) → request origin', async () => {
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', '127.0.0.1:3001')
        expect(redirectUriOf(res.headers.location))
            .toBe('http://127.0.0.1:3001/api/auth/callback')
    })

    it('malformed FRONTEND_URL falls back to the request origin instead of throwing', async () => {
        process.env.FRONTEND_URL = 'not a url'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', '127.0.0.1:3001')
        expect(res.status).toBe(302)
        expect(redirectUriOf(res.headers.location))
            .toBe('http://127.0.0.1:3001/api/auth/callback')
    })

    it('a spoofed Host header can only ever yield the request origin, never a third one', async () => {
        // The honest invariant: the redirect_uri host is either FRONTEND_URL's
        // host or the request's own Host — never anything else. A spoofed Host
        // therefore produces a redirect_uri GitHub rejects against the OAuth
        // App registration, which is where this actually stops. Asserting only
        // "does not contain the real host" would pass while codifying the
        // attacker-supplied value as expected output.
        process.env.FRONTEND_URL = 'https://repomanager.example.pt'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'evil.example')
        const uri = new URL(redirectUriOf(res.headers.location))
        expect(['repomanager.example.pt', 'evil.example']).toContain(uri.host)
        expect(uri.pathname).toBe('/api/auth/callback')
        // And the browser is still sent to GitHub, not to the spoofed host.
        expect(new URL(res.headers.location).host).toBe('github.com')
    })

    it('matches the host case-insensitively', async () => {
        process.env.FRONTEND_URL = 'https://repomanager.example.pt'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'RepoManager.Example.PT')
        expect(redirectUriOf(res.headers.location))
            .toBe('https://repomanager.example.pt/api/auth/callback')
    })

    it('matches when a proxy appends the scheme default port', async () => {
        // A hop that rewrites Host to `example.pt:443` must not fall through to
        // the request scheme — that is the failure this whole function exists
        // to prevent.
        process.env.FRONTEND_URL = 'https://repomanager.example.pt'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'repomanager.example.pt:443')
        expect(redirectUriOf(res.headers.location))
            .toBe('https://repomanager.example.pt/api/auth/callback')
    })

    it('never downgrades a TLS request to an http FRONTEND_URL', async () => {
        // MUST enable trust proxy: without it Express ignores
        // X-Forwarded-Proto, req.protocol stays 'http', and the guard branch is
        // never entered — the test then passes with the guard deleted, which is
        // exactly what an earlier version of it did.
        const app = express()
        app.set('trust proxy', 1)
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: true,
            // `secure` is omitted, not set to false: supertest speaks plain HTTP,
            // so a Secure cookie would never come back — and the explicit literal
            // is what trips CodeQL's clear-text-cookie rule. Default is false.
            cookie: { httpOnly: true, sameSite: 'lax' },
        }))
        app.use('/api/auth', authRouter)

        process.env.FRONTEND_URL = 'http://repomanager.example.pt'
        const res = await request(app)
            .get('/api/auth/login')
            .set('Host', 'repomanager.example.pt')
            .set('X-Forwarded-Proto', 'https')
        // A stale http:// FRONTEND_URL must not turn a genuinely-HTTPS request
        // into an http:// redirect_uri — GitHub would reject the mismatch, and
        // the authorization code would have travelled to a plaintext origin.
        expect(redirectUriOf(res.headers.location))
            .toBe('https://repomanager.example.pt/api/auth/callback')
    })

    it('ignores a FRONTEND_URL with a non-http scheme instead of emitting "null"', async () => {
        // new URL('foo://host').origin is the literal string "null", which
        // would ship `null/api/auth/callback` to GitHub.
        process.env.FRONTEND_URL = 'foo://repomanager.example.pt'
        const res = await request(buildApp())
            .get('/api/auth/login')
            .set('Host', 'repomanager.example.pt')
        const uri = redirectUriOf(res.headers.location)
        expect(uri).not.toContain('null')
        expect(uri).toBe('http://repomanager.example.pt/api/auth/callback')
    })
})
