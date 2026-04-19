// @vitest-environment node
/**
 * Tests for Phase Z.2 BYOK middleware changes:
 *  - createRequireAI: per-user provider resolution (no longer hard-checks GEMINI_API_KEY)
 *  - attachAIProvider: req.getAIProvider(), req.aiProvider, req.genAI legacy shim
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequireAI, attachAIProvider } from '../middleware/auth.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    }
    return res
}

function makeNext() {
    return vi.fn()
}

// A minimal fake provider with rawSDK (simulates GeminiProvider)
function fakeGeminiProvider() {
    return { name: 'gemini', rawSDK: { getGenerativeModel: vi.fn() }, generate: vi.fn() }
}

// A minimal fake provider without rawSDK (simulates Anthropic/OpenAI)
function fakeAnthropicProvider() {
    return { name: 'anthropic', generate: vi.fn() }
}

// ---------------------------------------------------------------------------
// createRequireAI — per-user provider paths
// ---------------------------------------------------------------------------

describe('createRequireAI (BYOK-aware)', () => {
    describe('no provider available (no user config, no env)', () => {
        it('returns 400 AI_NOT_CONFIGURED with configureUrl', async () => {
            // req has neither aiProvider nor getAIProvider
            const req = { session: { userId: 99 } }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(res.status).toHaveBeenCalledWith(400)
            const body = res.json.mock.calls[0][0]
            expect(body.error).toBe('AI_NOT_CONFIGURED')
            expect(body.configureUrl).toBe('/settings#ai')
            expect(next).not.toHaveBeenCalled()
        })

        it('returns 400 when getAIProvider resolves null', async () => {
            const req = {
                session: { userId: 99 },
                getAIProvider: vi.fn().mockResolvedValue(null),
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(res.status).toHaveBeenCalledWith(400)
            expect(next).not.toHaveBeenCalled()
        })

        it('returns 400 when getAIProvider rejects', async () => {
            const req = {
                session: { userId: 99 },
                getAIProvider: vi.fn().mockRejectedValue(new Error('db error')),
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(res.status).toHaveBeenCalledWith(400)
            expect(next).not.toHaveBeenCalled()
        })
    })

    describe('provider available via req.aiProvider (pre-populated by attachAIProvider)', () => {
        it('calls next when req.aiProvider is already set', async () => {
            const provider = fakeGeminiProvider()
            const req = {
                session: { userId: 1 },
                aiProvider: provider,
                genAI: provider.rawSDK,
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(next).toHaveBeenCalled()
            expect(res.status).not.toHaveBeenCalled()
        })

        it('sets req.genAI from rawSDK when rawSDK exists', async () => {
            const provider = fakeGeminiProvider()
            const req = {
                session: { userId: 1 },
                getAIProvider: vi.fn().mockResolvedValue(provider),
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(next).toHaveBeenCalled()
            expect(req.aiProvider).toBe(provider)
            expect(req.genAI).toBe(provider.rawSDK)
        })

        it('does not set req.genAI for non-Gemini providers (no rawSDK)', async () => {
            const provider = fakeAnthropicProvider()
            const req = {
                session: { userId: 1 },
                getAIProvider: vi.fn().mockResolvedValue(provider),
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI({})
            await middleware(req, res, next)

            expect(next).toHaveBeenCalled()
            expect(req.aiProvider).toBe(provider)
            expect(req.genAI).toBeUndefined()
        })
    })

    describe('legacy aiService argument (backward compat)', () => {
        it('accepts aiService argument without using it — provider from getAIProvider wins', async () => {
            const provider = fakeGeminiProvider()
            const legacyAiService = { genAI: { legacy: true }, provider: null }
            const req = {
                session: { userId: 1 },
                getAIProvider: vi.fn().mockResolvedValue(provider),
            }
            const res = makeRes()
            const next = makeNext()

            const middleware = createRequireAI(legacyAiService)
            await middleware(req, res, next)

            expect(next).toHaveBeenCalled()
            // Provider is from getAIProvider, NOT from legacyAiService
            expect(req.aiProvider).toBe(provider)
        })
    })
})

// ---------------------------------------------------------------------------
// attachAIProvider middleware
// ---------------------------------------------------------------------------

describe('attachAIProvider middleware', () => {
    let origCreateProvider

    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('attaches req.getAIProvider function', async () => {
        const provider = fakeGeminiProvider()
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: vi.fn().mockResolvedValue(provider),
        }))

        // Re-import after mock
        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        const res = {}
        const next = makeNext()

        await mw(req, res, next)

        expect(typeof req.getAIProvider).toBe('function')
        expect(next).toHaveBeenCalled()
    })

    it('caches provider per kind on the request', async () => {
        const provider = fakeGeminiProvider()
        const mockCreate = vi.fn().mockResolvedValue(provider)
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: mockCreate,
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        await mw(req, {}, makeNext())

        // Call getAIProvider twice — should only call createProviderForUser once
        const p1 = await req.getAIProvider('completion')
        const p2 = await req.getAIProvider('completion')

        expect(p1).toBe(p2)
        // createProviderForUser called once during middleware init + 0 more (cached)
        const completionCalls = mockCreate.mock.calls.filter(([, kind]) => kind === 'completion')
        expect(completionCalls.length).toBe(1)
    })

    it('sets req.aiProvider and req.genAI from Gemini provider rawSDK', async () => {
        const provider = fakeGeminiProvider()
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: vi.fn().mockResolvedValue(provider),
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        await mw(req, {}, makeNext())

        expect(req.aiProvider).toBe(provider)
        expect(req.genAI).toBe(provider.rawSDK)
    })

    it('sets req.aiProvider but NOT req.genAI for non-Gemini providers', async () => {
        const provider = fakeAnthropicProvider()
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: vi.fn().mockResolvedValue(provider),
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        await mw(req, {}, makeNext())

        expect(req.aiProvider).toBe(provider)
        expect(req.genAI).toBeNull()
    })

    it('does not set req.aiProvider when provider is null (no config, no env)', async () => {
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: vi.fn().mockResolvedValue(null),
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        await mw(req, {}, makeNext())

        expect(req.aiProvider).toBeUndefined()
        expect(req.genAI).toBeUndefined()
    })

    it('still calls next even when createProviderForUser throws', async () => {
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: vi.fn().mockRejectedValue(new Error('db down')),
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = { session: { userId: 1 } }
        const next = makeNext()
        await mw(req, {}, next)

        expect(next).toHaveBeenCalled()
        expect(req.aiProvider).toBeUndefined()
    })

    it('handles missing session gracefully (userId = undefined)', async () => {
        const provider = fakeGeminiProvider()
        const mockCreate = vi.fn().mockResolvedValue(provider)
        vi.doMock('../lib/ai-provider.js', () => ({
            createProviderForUser: mockCreate,
        }))

        const { attachAIProvider: attach } = await import('../middleware/auth.js')
        const mw = attach()

        const req = {} // no session
        await mw(req, {}, makeNext())

        expect(mockCreate).toHaveBeenCalledWith(undefined, 'completion')
    })
})
