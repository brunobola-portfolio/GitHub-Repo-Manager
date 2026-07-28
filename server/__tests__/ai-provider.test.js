// @vitest-environment node
/**
 * Tests for server/lib/ai-provider.js
 *
 * Verifies:
 *  - AIError shape and codes
 *  - toAIError mapping rules
 *  - GeminiProvider.generate() — fence stripping, schema parsing, error normalisation
 *  - GeminiProvider.embed()
 *  - GeminiProvider.generateStream()
 *  - createProvider() — env reading, production guard, unknown provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIError, AI_ERROR_CODE, toAIError, GeminiProvider, createProvider } from '../lib/ai-provider.js'

// ---------------------------------------------------------------------------
// Mock @google/generative-ai so no real network calls are made
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn()
const mockEmbedContent = vi.fn()
const mockGenerateContentStream = vi.fn()

const mockModel = {
    generateContent: (...args) => mockGenerateContent(...args),
    embedContent: (...args) => mockEmbedContent(...args),
    generateContentStream: (...args) => mockGenerateContentStream(...args),
}

vi.mock('@google/generative-ai', () => {
    const GoogleGenerativeAI = function GoogleGenerativeAI() {
        this.getGenerativeModel = vi.fn(() => mockModel)
    }
    return { GoogleGenerativeAI }
})

vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// ---------------------------------------------------------------------------
// AIError
// ---------------------------------------------------------------------------

describe('AIError', () => {
    it('extends Error', () => {
        const err = new AIError({ code: 'QUOTA', message: 'rate limited' })
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(AIError)
    })

    it('has code, status, and cause properties', () => {
        const cause = new Error('original')
        const err = new AIError({ code: AI_ERROR_CODE.AUTH, message: 'bad key', status: 401, cause })
        expect(err.code).toBe('AUTH')
        expect(err.status).toBe(401)
        expect(err.cause).toBe(cause)
        expect(err.message).toBe('bad key')
        expect(err.name).toBe('AIError')
    })

    it('defaults to UNKNOWN code when not specified', () => {
        const err = new AIError({})
        expect(err.code).toBe(AI_ERROR_CODE.UNKNOWN)
    })

    it('has all required codes in AI_ERROR_CODE', () => {
        const requiredCodes = ['QUOTA', 'AUTH', 'OVERLOAD', 'NOT_FOUND', 'INVALID_RESPONSE', 'CANCELED', 'UNKNOWN']
        for (const code of requiredCodes) {
            expect(AI_ERROR_CODE[code]).toBe(code)
        }
    })

    it('AI_ERROR_CODE is frozen', () => {
        expect(Object.isFrozen(AI_ERROR_CODE)).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// toAIError
// ---------------------------------------------------------------------------

describe('toAIError', () => {
    it('returns the same AIError when passed an AIError', () => {
        const err = new AIError({ code: AI_ERROR_CODE.QUOTA })
        expect(toAIError(err)).toBe(err)
    })

    it('maps status 404 to NOT_FOUND', () => {
        const err = toAIError(Object.assign(new Error('model not found'), { status: 404 }))
        expect(err).toBeInstanceOf(AIError)
        expect(err.code).toBe(AI_ERROR_CODE.NOT_FOUND)
        expect(err.status).toBe(404)
    })

    it('maps "not found" string to NOT_FOUND', () => {
        const err = toAIError(new Error('The model was not found'))
        expect(err.code).toBe(AI_ERROR_CODE.NOT_FOUND)
    })

    it('maps status 401 to AUTH', () => {
        const err = toAIError(Object.assign(new Error('invalid key'), { status: 401 }))
        expect(err.code).toBe(AI_ERROR_CODE.AUTH)
        expect(err.status).toBe(401)
    })

    it('maps "API key" string to AUTH', () => {
        const err = toAIError(new Error('Invalid API key provided'))
        expect(err.code).toBe(AI_ERROR_CODE.AUTH)
    })

    it('maps status 429 to RATE_LIMITED (distinct from QUOTA)', () => {
        const err = toAIError(Object.assign(new Error('rate limit'), { status: 429 }))
        expect(err.code).toBe(AI_ERROR_CODE.RATE_LIMITED)
        expect(err.status).toBe(429)
    })

    it('maps "quota" string to QUOTA', () => {
        const err = toAIError(new Error('You have exceeded your quota'))
        expect(err.code).toBe(AI_ERROR_CODE.QUOTA)
    })

    it('maps status 503 to OVERLOAD', () => {
        const err = toAIError(Object.assign(new Error('service unavailable'), { status: 503 }))
        expect(err.code).toBe(AI_ERROR_CODE.OVERLOAD)
        expect(err.status).toBe(503)
    })

    it('maps "overload" string to OVERLOAD', () => {
        const err = toAIError(new Error('The model is overloaded'))
        expect(err.code).toBe(AI_ERROR_CODE.OVERLOAD)
    })

    it('maps "high demand" string to OVERLOAD', () => {
        const err = toAIError(new Error('Currently experiencing high demand'))
        expect(err.code).toBe(AI_ERROR_CODE.OVERLOAD)
    })

    it('maps "unavailable" string to OVERLOAD', () => {
        const err = toAIError(new Error('Service temporarily unavailable'))
        expect(err.code).toBe(AI_ERROR_CODE.OVERLOAD)
    })

    it('returns UNKNOWN for unmatched errors', () => {
        const err = toAIError(new Error('something completely different'))
        expect(err.code).toBe(AI_ERROR_CODE.UNKNOWN)
    })

    it('preserves the original error in .cause', () => {
        const original = new Error('original error')
        const err = toAIError(original)
        expect(err.cause).toBe(original)
    })

    it('handles non-Error objects gracefully', () => {
        const err = toAIError('string error')
        expect(err).toBeInstanceOf(AIError)
        expect(err.code).toBe(AI_ERROR_CODE.UNKNOWN)
    })

    it('handles null/undefined gracefully', () => {
        expect(toAIError(null).code).toBe(AI_ERROR_CODE.UNKNOWN)
        expect(toAIError(undefined).code).toBe(AI_ERROR_CODE.UNKNOWN)
    })
})

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

describe('GeminiProvider', () => {
    let provider

    beforeEach(() => {
        vi.clearAllMocks()
        provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-test', embeddingModel: 'embed-test' })
    })

    describe('generate()', () => {
        it('returns text from a simple prompt', async () => {
            mockGenerateContent.mockResolvedValue({ response: { text: () => 'Hello world' } })
            const result = await provider.generate({ prompt: 'say hello' })
            expect(result.text).toBe('Hello world')
            expect(result.parsed).toBeUndefined()
        })

        it('strips markdown code fences (```json ... ```)', async () => {
            mockGenerateContent.mockResolvedValue({
                response: { text: () => '```json\n{"key": "value"}\n```' }
            })
            const result = await provider.generate({ prompt: 'give json' })
            expect(result.text).toBe('{"key": "value"}')
        })

        it('strips bare ``` fences', async () => {
            mockGenerateContent.mockResolvedValue({
                response: { text: () => '```\nsome text\n```' }
            })
            const result = await provider.generate({ prompt: 'test' })
            expect(result.text).toBe('some text')
        })

        it('with schema: returns text AND parsed JSON', async () => {
            const payload = { answer: 42 }
            mockGenerateContent.mockResolvedValue({
                response: { text: () => JSON.stringify(payload) }
            })
            const schema = { type: 'object', properties: { answer: { type: 'number' } } }
            const result = await provider.generate({ prompt: 'give json', schema })
            expect(result.text).toBe(JSON.stringify(payload))
            expect(result.parsed).toEqual(payload)
        })

        it('with schema: throws AIError(INVALID_RESPONSE) when parse fails', async () => {
            mockGenerateContent.mockResolvedValue({
                response: { text: () => 'not valid json at all {{{}' }
            })
            const schema = { type: 'object' }
            await expect(provider.generate({ prompt: 'test', schema }))
                .rejects.toMatchObject({ code: AI_ERROR_CODE.INVALID_RESPONSE })
        })

        it('uses parts array as multi-part contents (anti-injection)', async () => {
            mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } })
            const parts = [{ text: 'system' }, { text: 'user content' }]
            await provider.generate({ parts })
            const callArg = mockGenerateContent.mock.calls[0][0]
            expect(callArg.contents[0].parts).toEqual(parts)
        })

        it('normalises SDK errors via toAIError', async () => {
            // 429 now normalises to RATE_LIMITED (429 billing-style quota
            // would arrive as 403 and still map to QUOTA).
            const sdkErr = Object.assign(new Error('rate limit exceeded'), { status: 429 })
            mockGenerateContent.mockRejectedValue(sdkErr)
            await expect(provider.generate({ prompt: 'test' }))
                .rejects.toMatchObject({ code: AI_ERROR_CODE.RATE_LIMITED })
        })

        it('propagates AIError unchanged (does not double-wrap)', async () => {
            const aiErr = new AIError({ code: AI_ERROR_CODE.NOT_FOUND })
            mockGenerateContent.mockRejectedValue(aiErr)
            await expect(provider.generate({ prompt: 'test' })).rejects.toBe(aiErr)
        })

        it('aliases OpenAI-style max_tokens to Gemini maxOutputTokens', async () => {
            mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } })
            await provider.generate({ prompt: 'test', generationConfig: { max_tokens: 12 } })
            const req = mockGenerateContent.mock.calls[0][0]
            expect(req.generationConfig).toEqual({ maxOutputTokens: 12 })
            expect(req.generationConfig).not.toHaveProperty('max_tokens')
        })

        it('strips unknown generationConfig keys so the REST API cannot 400 on them', async () => {
            mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } })
            await provider.generate({
                prompt: 'test',
                generationConfig: { temperature: 0.3, bogusField: 'x', maxOutputTokens: 10 },
            })
            const req = mockGenerateContent.mock.calls[0][0]
            expect(req.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 10 })
            expect(req.generationConfig).not.toHaveProperty('bogusField')
        })

        it('prefers explicit maxOutputTokens over aliased max_tokens when both present', async () => {
            mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } })
            await provider.generate({
                prompt: 'test',
                generationConfig: { max_tokens: 5, maxOutputTokens: 20 },
            })
            const req = mockGenerateContent.mock.calls[0][0]
            // Object.entries iterates in insertion order, so max_tokens is seen
            // first and seeds maxOutputTokens, then the explicit one overwrites.
            expect(req.generationConfig.maxOutputTokens).toBe(20)
        })
    })

    describe('embed()', () => {
        it('returns the embedding values array', async () => {
            const values = [0.1, 0.2, 0.3]
            mockEmbedContent.mockResolvedValue({ embedding: { values } })
            const result = await provider.embed('some text')
            expect(result).toEqual(values)
        })

        it('normalises SDK errors via toAIError', async () => {
            const sdkErr = Object.assign(new Error('model not found'), { status: 404 })
            mockEmbedContent.mockRejectedValue(sdkErr)
            await expect(provider.embed('text'))
                .rejects.toMatchObject({ code: AI_ERROR_CODE.NOT_FOUND })
        })

        it('throws AIError(NOT_FOUND) when embeddingModel is null', async () => {
            // Simulate failed model init
            provider.embeddingModel = null
            await expect(provider.embed('text'))
                .rejects.toMatchObject({ code: AI_ERROR_CODE.NOT_FOUND })
        })
    })

    describe('generateStream()', () => {
        function makeStream(chunks) {
            async function* gen() {
                for (const c of chunks) {
                    yield { text: () => c }
                }
            }
            return { stream: gen() }
        }

        it('yields text chunks from the stream', async () => {
            mockGenerateContentStream.mockResolvedValue(makeStream(['hello', ' ', 'world']))
            const chunks = []
            for await (const chunk of provider.generateStream({ prompt: 'stream me' })) {
                chunks.push(chunk)
            }
            expect(chunks).toEqual(['hello', ' ', 'world'])
        })

        it('stops when signal is aborted mid-stream', async () => {
            const controller = new AbortController()
            // Stream that fires signal abort between first and second chunk
            async function* gen() {
                yield { text: () => 'first' }
                controller.abort()
                yield { text: () => 'second' }
            }
            mockGenerateContentStream.mockResolvedValue({ stream: gen() })
            const chunks = []
            for await (const chunk of provider.generateStream({ prompt: 'test', signal: controller.signal })) {
                chunks.push(chunk)
            }
            // 'second' may or may not appear depending on timing; 'first' must be there
            // and we should get at most 2 chunks (abort fires after first is yielded)
            expect(chunks[0]).toBe('first')
        })

        it('normalises SDK errors via toAIError', async () => {
            const sdkErr = Object.assign(new Error('API key invalid'), { status: 401 })
            mockGenerateContentStream.mockRejectedValue(sdkErr)
            const gen = provider.generateStream({ prompt: 'test' })
            await expect(gen.next()).rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH })
        })

        it('skips empty chunks (does not yield empty strings)', async () => {
            mockGenerateContentStream.mockResolvedValue(makeStream(['a', '', 'b']))
            const chunks = []
            for await (const chunk of provider.generateStream({ prompt: 'test' })) {
                chunks.push(chunk)
            }
            expect(chunks).toEqual(['a', 'b'])
        })

        it('returns usage + costUSD from the post-stream response metadata', async () => {
            async function* gen() { yield { text: () => 'hi' } }
            mockGenerateContentStream.mockResolvedValue({
                stream: gen(),
                response: Promise.resolve({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 } }),
            })
            const iter = provider.generateStream({ prompt: 'x' })
            const first = await iter.next()
            expect(first.value).toBe('hi')
            const final = await iter.next()
            expect(final.done).toBe(true)
            expect(final.value.usage).toEqual({ inputTokens: 12, outputTokens: 7 })
            expect(typeof final.value.costUSD).toBe('number')
            expect(final.value.costUSD).toBeGreaterThan(0)
        })

        it('still reads post-stream usage after the client disconnects', async () => {
            // The prompt was billed the moment the request landed, and the SDK
            // aggregates the chunks it did receive — so an abort must not
            // short-circuit past the usage lookup and record the call as free.
            async function* gen() { yield { text: () => 'hi' }; yield { text: () => 'there' } }
            mockGenerateContentStream.mockResolvedValue({
                stream: gen(),
                response: Promise.resolve({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 4 } }),
            })
            const controller = new AbortController()
            const iter = provider.generateStream({ prompt: 'x', signal: controller.signal })
            expect((await iter.next()).value).toBe('hi')
            controller.abort()
            const final = await iter.next()

            expect(final.done).toBe(true)
            expect(final.value.usage).toEqual({ inputTokens: 900, outputTokens: 4 })
            expect(final.value.costUSD).toBeGreaterThan(0)
            expect(final.value.partial).toBe(true)
        })

        it('does not pull another chunk from a stream whose fetch was torn down', async () => {
            // Aborting the request destroys the underlying body, so the next
            // pull throws. Without a post-yield abort check that exception
            // escapes generateStream and takes the usage lookup with it.
            async function* gen() {
                yield { text: () => 'hi' }
                throw new Error('The user aborted a request.')
            }
            mockGenerateContentStream.mockResolvedValue({
                stream: gen(),
                response: Promise.resolve({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 4 } }),
            })
            const controller = new AbortController()
            const iter = provider.generateStream({ prompt: 'x', signal: controller.signal })
            await iter.next()
            controller.abort()
            const final = await iter.next()

            expect(final.value.usage).toEqual({ inputTokens: 900, outputTokens: 4 })
        })

        it('records an unknown cost, not a free one, when an aborted stream cannot report usage', async () => {
            async function* gen() { yield { text: () => 'hi' } }
            mockGenerateContentStream.mockResolvedValue({
                stream: gen(),
                response: Promise.reject(new Error('stream torn down')),
            })
            const controller = new AbortController()
            const iter = provider.generateStream({ prompt: 'x', signal: controller.signal })
            await iter.next()
            controller.abort()
            const final = await iter.next()

            expect(final.value).toEqual({ usage: null, costUSD: null, partial: true })
        })

        it('returns null usage/costUSD when the stream has no response metadata', async () => {
            mockGenerateContentStream.mockResolvedValue(makeStream(['a']))
            const iter = provider.generateStream({ prompt: 'x' })
            await iter.next()
            const final = await iter.next()
            expect(final.done).toBe(true)
            expect(final.value).toEqual({ usage: null, costUSD: null, partial: false })
        })
    })
})

// ---------------------------------------------------------------------------
// createProvider
// ---------------------------------------------------------------------------

describe('createProvider', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        vi.clearAllMocks()
        // Reset env to avoid cross-test pollution
        delete process.env.AI_PROVIDER
        delete process.env.GEMINI_API_KEY
        delete process.env.GEMINI_MODEL
        delete process.env.GEMINI_EMBEDDING_MODEL
        delete process.env.NODE_ENV
    })

    afterEach(() => {
        // Restore original env
        Object.assign(process.env, originalEnv)
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key]
        }
    })

    it('returns null (not a crash) when GEMINI_API_KEY is unset outside production', () => {
        delete process.env.GEMINI_API_KEY
        const provider = createProvider()
        expect(provider).toBeNull()
    })

    it('defaults to Gemini when AI_PROVIDER is not set', () => {
        process.env.GEMINI_API_KEY = 'test-key'
        const provider = createProvider()
        expect(provider).toBeInstanceOf(GeminiProvider)
    })

    it('explicitly set AI_PROVIDER=gemini works', () => {
        process.env.AI_PROVIDER = 'gemini'
        process.env.GEMINI_API_KEY = 'test-key'
        const provider = createProvider()
        expect(provider).toBeInstanceOf(GeminiProvider)
    })

    it('reads AI_MODEL_<FEATURE> override when present', () => {
        process.env.GEMINI_API_KEY = 'test-key'
        process.env.AI_MODEL_REVIEW = 'gemini-2.5-pro'
        const provider = createProvider('REVIEW')
        expect(provider._modelName).toBe('gemini-2.5-pro')
    })

    it('falls back to GEMINI_MODEL when no feature override exists', () => {
        process.env.GEMINI_API_KEY = 'test-key'
        process.env.GEMINI_MODEL = 'gemini-custom'
        const provider = createProvider('CHAT')
        expect(provider._modelName).toBe('gemini-custom')
    })

    it('throws in production when GEMINI_API_KEY is missing', () => {
        process.env.NODE_ENV = 'production'
        delete process.env.GEMINI_API_KEY
        expect(() => createProvider()).toThrow(/GEMINI_API_KEY is required in production/)
    })

    it('throws a helpful error when AI_PROVIDER is unknown', () => {
        process.env.AI_PROVIDER = 'anthropic'
        process.env.GEMINI_API_KEY = 'test-key'
        expect(() => createProvider()).toThrow(/Unknown AI_PROVIDER/)
    })
})
