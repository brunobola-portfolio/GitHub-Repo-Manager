import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const store = new Map()

vi.mock('../db.js', () => ({
    default: {
        prepare: (sql) => {
            const normalized = sql.replace(/\s+/g, ' ').trim()
            if (normalized.startsWith('SELECT prompt FROM user_ai_prompts')) {
                return {
                    get: (userId, key) => {
                        const row = store.get(`${userId}:${key}`)
                        return row ? { prompt: row.prompt } : undefined
                    },
                }
            }
            if (normalized.startsWith('SELECT feature_key, prompt, updated_at FROM user_ai_prompts')) {
                return {
                    all: (userId) => {
                        const out = []
                        for (const [k, v] of store.entries()) {
                            const [uid, fk] = k.split(':')
                            if (Number(uid) === userId) out.push({ feature_key: fk, prompt: v.prompt, updated_at: v.updatedAt })
                        }
                        return out
                    },
                }
            }
            if (normalized.startsWith('INSERT INTO user_ai_prompts')) {
                return {
                    run: (userId, key, prompt) => {
                        store.set(`${userId}:${key}`, { prompt, updatedAt: '2026-05-01T00:00:00Z' })
                        return { changes: 1 }
                    },
                }
            }
            if (normalized.startsWith('DELETE FROM user_ai_prompts')) {
                return {
                    run: (userId, key) => {
                        const k = `${userId}:${key}`
                        const had = store.has(k)
                        store.delete(k)
                        return { changes: had ? 1 : 0 }
                    },
                }
            }
            throw new Error(`Unmocked SQL: ${normalized}`)
        },
    },
}))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            if (!req.session?.userId) return res.status(401).json({ error: 'Session expired' })
            next()
        },
    }
})

vi.mock('../middleware/validate-request.js', async () => {
    const actual = await vi.importActual('../middleware/validate-request.js')
    return actual
})

const { default: promptsRouter } = await import('../routes/ai/prompts.js')

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { userId: 7 }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api', promptsRouter)
    return app
}

beforeEach(() => {
    store.clear()
})

describe('GET /api/ai/prompts', () => {
    it('returns the catalog with hasOverride=false initially', async () => {
        const res = await request(buildApp()).get('/api/ai/prompts')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.prompts)).toBe(true)
        expect(res.body.prompts.length).toBeGreaterThan(0)
        const chat = res.body.prompts.find(p => p.key === 'chat')
        expect(chat).toMatchObject({ hasOverride: false, userPrompt: null })
        expect(chat.defaultPrompt.length).toBeGreaterThan(20)
    })

    it('merges existing user overrides into the catalog', async () => {
        store.set('7:chat', { prompt: 'Speak like a pirate.', updatedAt: '2026-05-01T00:00:00Z' })
        const res = await request(buildApp()).get('/api/ai/prompts')
        const chat = res.body.prompts.find(p => p.key === 'chat')
        expect(chat.hasOverride).toBe(true)
        expect(chat.userPrompt).toBe('Speak like a pirate.')
        expect(chat.updatedAt).toBe('2026-05-01T00:00:00Z')
    })

    it('returns 401 without an authenticated session', async () => {
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => { req.session = {}; req.log = { error: vi.fn() }; next() })
        app.use('/api', promptsRouter)
        const res = await request(app).get('/api/ai/prompts')
        expect(res.status).toBe(401)
    })
})

describe('PUT /api/ai/prompts/:key', () => {
    it('saves a user override and echoes the new shape back', async () => {
        const res = await request(buildApp())
            .put('/api/ai/prompts/chat')
            .send({ prompt: 'Be brief.' })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ key: 'chat', prompt: 'Be brief.', hasOverride: true })
        expect(typeof res.body.defaultPrompt).toBe('string')
        expect(store.get('7:chat').prompt).toBe('Be brief.')
    })

    it('rejects unknown keys with 400 + allowed list', async () => {
        const res = await request(buildApp())
            .put('/api/ai/prompts/totally_made_up')
            .send({ prompt: 'x' })
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/Unknown prompt key/i)
        expect(Array.isArray(res.body.allowed)).toBe(true)
    })

    it('rejects empty / whitespace prompts via the schema', async () => {
        const res = await request(buildApp())
            .put('/api/ai/prompts/chat')
            .send({ prompt: '' })
        expect(res.status).toBe(400)
    })

    it('rejects prompts over the 8000 character limit', async () => {
        const res = await request(buildApp())
            .put('/api/ai/prompts/chat')
            .send({ prompt: 'a'.repeat(8001) })
        expect(res.status).toBe(400)
    })
})

describe('DELETE /api/ai/prompts/:key', () => {
    it('clears an existing override', async () => {
        store.set('7:chat', { prompt: 'Old', updatedAt: 'x' })
        const res = await request(buildApp()).delete('/api/ai/prompts/chat')
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ key: 'chat', hasOverride: false })
        expect(store.has('7:chat')).toBe(false)
    })

    it('is idempotent — deleting a missing override still returns 200', async () => {
        const res = await request(buildApp()).delete('/api/ai/prompts/chat')
        expect(res.status).toBe(200)
        expect(res.body.hasOverride).toBe(false)
    })

    it('rejects unknown keys with 400', async () => {
        const res = await request(buildApp()).delete('/api/ai/prompts/not_a_key')
        expect(res.status).toBe(400)
    })
})
