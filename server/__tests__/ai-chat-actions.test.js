import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockGenerateContent = vi.fn()
const mockModel = { generateContent: (...args) => mockGenerateContent(...args) }

vi.mock('../ai-service.js', () => ({
    aiService: {
        model: mockModel,
        genAI: { getGenerativeModel: () => mockModel },
    },
    sanitizeForPrompt: (s) => s,
}))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
            next()
        },
        // Provider-neutral /ai/chat now reads req.aiProvider.generate({prompt, schema}).
        // Wrap the raw-SDK mockGenerateContent so existing cases continue to assert
        // via the same fake model call — the schema path returns { text, parsed } and
        // the test inspects text. Overload errors from mockGenerateContent surface as
        // thrown AIError instances, which providerGenerateWithRetry handles.
        createRequireAI: () => (req, res, next) => {
            req.genAI = { getGenerativeModel: () => mockModel }
            req.aiProvider = {
                async generate({ prompt, schema }) {
                    const result = await mockGenerateContent({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        ...(schema ? { generationConfig: { responseMimeType: 'application/json', responseSchema: schema } } : {}),
                    })
                    const text = result.response.text()
                    if (schema) {
                        try { return { text, parsed: JSON.parse(text) } } catch { return { text } }
                    }
                    return { text }
                },
            }
            next()
        },
    }
})

vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: vi.fn(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 })),
    incrementUsage: vi.fn(),
    checkAIFeatureLimit: vi.fn(() => ({ allowed: true })),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: vi.fn(() => ({ error: 'usage_limit_exceeded' })),
}))

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1 })) })),
        transaction: (fn) => fn,
    },
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn(() => Promise.resolve({ data: {} })) }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: (v) => { try { return JSON.parse(v) } catch { return null } } }))
vi.mock('../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
}))
vi.mock('../lib/validators.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        validate: () => (req, res, next) => next(),
    }
})

async function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'tok', userId: 1, user: { id: 1, login: 'alice' } }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    const { default: aiRouter } = await import('../routes/ai.js')
    app.use('/api', aiRouter)
    return app
}

describe('POST /api/ai/chat (JSON mode with actions)', () => {
    beforeEach(() => vi.clearAllMocks())

    it('returns reply + actions when the model emits a valid JSON payload', async () => {
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({
                    reply: 'Vou abrir o assistente de migração para ti.',
                    actions: [{ type: 'open_migration_wizard', label: 'Abrir Assistente' }],
                }),
            },
        })

        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/chat')
            .send({ message: 'quero migrar um projeto abre o assistente' })

        expect(res.status).toBe(200)
        expect(res.body.reply).toMatch(/assistente de migração/i)
        expect(res.body.actions).toEqual([
            { type: 'open_migration_wizard', label: 'Abrir Assistente' },
        ])
    })

    it('returns reply with empty actions when the model omits the actions key', async () => {
        mockGenerateContent.mockResolvedValue({
            response: { text: () => JSON.stringify({ reply: 'Olá!' }) },
        })

        const app = await buildApp()
        const res = await request(app).post('/api/ai/chat').send({ message: 'oi' })

        expect(res.status).toBe(200)
        expect(res.body.reply).toBe('Olá!')
        expect(res.body.actions).toEqual([])
    })

    it('responds 502 AI_PARSE_ERROR when the model returns non-JSON', async () => {
        mockGenerateContent.mockResolvedValue({
            response: { text: () => 'Hello, I cannot reply as JSON.' },
        })

        const app = await buildApp()
        const res = await request(app).post('/api/ai/chat').send({ message: 'hi' })

        expect(res.status).toBe(502)
        expect(res.body.code).toBe('AI_PARSE_ERROR')
    })

    it('rejects empty message with 400 MESSAGE_REQUIRED', async () => {
        const app = await buildApp()
        const res = await request(app).post('/api/ai/chat').send({ message: '   ' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('MESSAGE_REQUIRED')
    })

    it('passes generationConfig with responseMimeType=application/json to the model', async () => {
        mockGenerateContent.mockResolvedValue({
            response: { text: () => JSON.stringify({ reply: 'ok' }) },
        })

        const app = await buildApp()
        await request(app).post('/api/ai/chat').send({ message: 'hello' })

        expect(mockGenerateContent).toHaveBeenCalledTimes(1)
        const callArg = mockGenerateContent.mock.calls[0][0]
        expect(callArg.generationConfig.responseMimeType).toBe('application/json')
        expect(callArg.generationConfig.responseSchema.required).toContain('reply')
    })

    it('maps Gemini 503 overload to AI_OVERLOADED with specific copy', async () => {
        const overloadErr = Object.assign(new Error('[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently experiencing high demand.'), { status: 503 })
        // providerGenerateWithRetry now retries 3 times (4 total attempts)
        // on OVERLOAD, so exhaust every attempt to reach the error handler.
        mockGenerateContent.mockRejectedValue(overloadErr)

        const app = await buildApp()
        const res = await request(app).post('/api/ai/chat').send({ message: 'hi' })

        expect(res.status).toBe(503)
        expect(res.body.code).toBe('AI_OVERLOADED')
        expect(res.body.error).toMatch(/heavy load|moment|try again/i)
        // 1 initial + 3 retries = 4 attempts
        expect(mockGenerateContent).toHaveBeenCalledTimes(4)
    }, 15000)

    it('recovers when the first 503 is followed by a successful retry', async () => {
        const overloadErr = Object.assign(new Error('overload'), { status: 503 })
        mockGenerateContent
            .mockRejectedValueOnce(overloadErr)
            .mockResolvedValueOnce({
                response: { text: () => JSON.stringify({ reply: 'Recovered after retry.' }) },
            })

        const app = await buildApp()
        const res = await request(app).post('/api/ai/chat').send({ message: 'hi' })

        expect(res.status).toBe(200)
        expect(res.body.reply).toBe('Recovered after retry.')
        expect(mockGenerateContent).toHaveBeenCalledTimes(2)
    })
})
