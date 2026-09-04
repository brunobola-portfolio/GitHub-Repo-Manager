// @vitest-environment node
/**
 * BYOK Phase Z.2 — In-process E2E smoke test.
 *
 * Spins up an Express app with:
 *   - attachAIProvider middleware (per-user provider lookup)
 *   - createRequireAI guard
 *   - A dummy /api/ai/ping route that requires AI
 *
 * Stubs createProviderForUser so no DB or real API keys are needed.
 *
 * Scenarios:
 *  A. No user config, no env   → 400 AI_NOT_CONFIGURED with configureUrl
 *  B. User has BYOK config      → 200 OK, provider attached
 *  C. No user config, env key   → 200 OK, server fallback (Gemini)
 *  D. Legacy req.genAI shim     → Gemini provider sets req.genAI
 *  E. Non-Gemini user provider  → req.genAI is null/falsy
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// We must mock ai-provider BEFORE importing anything that uses it
vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: vi.fn(),
    GeminiProvider: class GeminiProvider {
        constructor({ apiKey, model = 'gemini-2.5-flash' }) {
            this.apiKey = apiKey
            this._modelName = model
            this.genAI = { stub: true }
        }
        get rawSDK() { return this.genAI }
    },
}))

// Also mock db to avoid SQLite in test env
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn() })),
    },
}))

vi.mock('../config.js', () => ({
    config: { nodeEnv: 'test' },
    default: { nodeEnv: 'test' },
}))

import { createProviderForUser } from '../lib/ai-provider.js'
import { attachAIProvider, createRequireAI } from '../middleware/auth.js'

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp({ provider: _provider } = {}) {
    const app = express()
    app.use(express.json())

    // Fake session middleware
    app.use((req, _res, next) => {
        req.session = { userId: 42, accessToken: 'tok' }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })

    // The middleware under test
    app.use(attachAIProvider())

    const requireAI = createRequireAI({})

    // Dummy protected route
    app.get('/api/ai/ping', requireAI, (req, res) => {
        res.json({
            ok: true,
            hasProvider: !!req.aiProvider,
            hasGenAI: !!req.genAI,
            providerName: req.aiProvider?.name ?? null,
        })
    })

    return app
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const savedEnv = {}

beforeEach(() => {
    savedEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
})

afterEach(() => {
    if (savedEnv.GEMINI_API_KEY !== undefined) {
        process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY
    } else {
        delete process.env.GEMINI_API_KEY
    }
    vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Scenario A: No user config, no env
// ---------------------------------------------------------------------------

describe('Scenario A — no provider (no user config, no GEMINI_API_KEY)', () => {
    it('returns 400 AI_NOT_CONFIGURED with configureUrl', async () => {
        createProviderForUser.mockResolvedValue(null)

        const app = buildApp()
        const res = await request(app).get('/api/ai/ping')

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('AI_NOT_CONFIGURED')
        expect(res.body.error).toMatch(/provider API key/i)
        expect(res.body.configureUrl).toBe('/settings#ai')
    })
})

// ---------------------------------------------------------------------------
// Scenario B: User has BYOK config
// ---------------------------------------------------------------------------

describe('Scenario B — user BYOK provider configured', () => {
    it('returns 200 and provider is attached', async () => {
        const mockProvider = {
            name: 'gemini',
            rawSDK: { getGenerativeModel: vi.fn() },
            generate: vi.fn(),
        }
        createProviderForUser.mockResolvedValue(mockProvider)

        const app = buildApp()
        const res = await request(app).get('/api/ai/ping')

        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
        expect(res.body.hasProvider).toBe(true)
    })

    it('sets hasGenAI=true when provider has rawSDK (Gemini)', async () => {
        const mockProvider = {
            name: 'gemini',
            rawSDK: { getGenerativeModel: vi.fn() },
        }
        createProviderForUser.mockResolvedValue(mockProvider)

        const app = buildApp()
        const res = await request(app).get('/api/ai/ping')

        expect(res.body.hasGenAI).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Scenario C: Server env fallback
// ---------------------------------------------------------------------------

describe('Scenario C — no user config but GEMINI_API_KEY env set', () => {
    it('returns 200 via server fallback', async () => {
        process.env.GEMINI_API_KEY = 'fake-env-key'

        // createProviderForUser will be called normally; since we mocked it above,
        // we need to make it return a provider to simulate the fallback path.
        const fallbackProvider = {
            name: 'gemini',
            rawSDK: { getGenerativeModel: vi.fn() },
        }
        createProviderForUser.mockResolvedValue(fallbackProvider)

        const app = buildApp()
        const res = await request(app).get('/api/ai/ping')

        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Scenario D: Non-Gemini provider — req.genAI is falsy
// ---------------------------------------------------------------------------

describe('Scenario D — Anthropic provider (no rawSDK)', () => {
    it('allows the route but hasGenAI=false', async () => {
        const anthropicProvider = {
            name: 'anthropic',
            // no rawSDK property
            generate: vi.fn(),
        }
        createProviderForUser.mockResolvedValue(anthropicProvider)

        const app = buildApp()
        const res = await request(app).get('/api/ai/ping')

        expect(res.status).toBe(200)
        expect(res.body.hasProvider).toBe(true)
        expect(res.body.hasGenAI).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Scenario E: Provider cache per request
// ---------------------------------------------------------------------------

describe('Scenario E — provider cache within a single request', () => {
    it('calls createProviderForUser only once per kind per request', async () => {
        const provider = { name: 'gemini', rawSDK: { stub: true } }
        createProviderForUser.mockResolvedValue(provider)

        // Build an app that calls getAIProvider twice on the same request
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => {
            req.session = { userId: 1 }
            next()
        })
        app.use(attachAIProvider())
        app.get('/test', async (req, res) => {
            const p1 = await req.getAIProvider('completion')
            const p2 = await req.getAIProvider('completion')
            res.json({ same: p1 === p2, callCount: createProviderForUser.mock.calls.length })
        })

        const res = await request(app).get('/test')
        expect(res.body.same).toBe(true)
        // Should have been called exactly once (during attachAIProvider shim) — second
        // getAIProvider call returns from cache.
        expect(res.body.callCount).toBe(1)
    })
})
