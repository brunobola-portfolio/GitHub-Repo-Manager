// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// --- Mocks ---

const mockPrepare = vi.fn()

vi.mock('../db.js', () => ({
    default: { prepare: mockPrepare },
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = req.session || {}
        req.session.userId = 42
        req.session.accessToken = 'ghp_mock'
        req.session.user = { tier: 'free' }
        req.userTier = 'free'
        next()
    },
}))

vi.mock('../middleware/api-key-auth.js', () => ({
    generateApiKey: vi.fn(() => ({
        id: 'generated-uuid-1',
        key: 'grm_live_mock_generated_key_abcdef',
        prefix: 'grm_live_mock_ge',
        keyHash: 'mockhash123abc',
    })),
}))

vi.mock('../lib/audit.js', () => ({
    auditLog: vi.fn(),
}))

vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(() => ({
        apiKeys: 5,
        maxRepos: 50,
        aiQueriesPerMonth: 100,
    })),
}))

vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

// --- Import after mocks ---

const { default: apiKeysRouter } = await import('../routes/api-keys.js')
const { generateApiKey } = await import('../middleware/api-key-auth.js')
const { auditLog } = await import('../lib/audit.js')
const { getFeatures } = await import('../lib/feature-flags.js')

// --- Test app setup ---

function createApp() {
    const app = express()
    app.use(express.json())
    // Simulate session middleware
    app.use((req, _res, next) => {
        req.session = req.session || {}
        next()
    })
    app.use('/api/api-keys', apiKeysRouter)
    return app
}

describe('GET /api/api-keys', () => {
    let app

    beforeEach(() => {
        app = createApp()
        mockPrepare.mockReset()
        vi.mocked(getFeatures).mockReturnValue({ apiKeys: 5 })
    })

    it('returns keys array with limits', async () => {
        const mockKeys = [
            {
                id: 'key-1',
                name: 'My Key',
                key_prefix: 'grm_live_abc123',
                scopes: '["read"]',
                last_used_at: null,
                last_used_ip: null,
                expires_at: null,
                created_at: '2025-01-01T00:00:00Z',
                revoked_at: null,
            },
            {
                id: 'key-2',
                name: 'Revoked Key',
                key_prefix: 'grm_live_def456',
                scopes: '["read","write"]',
                last_used_at: '2025-06-01T00:00:00Z',
                last_used_ip: '10.0.0.1',
                expires_at: '2026-01-01T00:00:00Z',
                created_at: '2025-02-01T00:00:00Z',
                revoked_at: '2025-06-15T00:00:00Z',
            },
        ]
        mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue(mockKeys) })

        const res = await request(app).get('/api/api-keys')

        expect(res.status).toBe(200)
        expect(res.body.keys).toHaveLength(2)
        expect(res.body.limits).toEqual({
            current: 1, // only 1 non-revoked
            max: 5,
            tier: 'free',
        })
    })

    it('returns empty keys array when user has no keys', async () => {
        mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) })

        const res = await request(app).get('/api/api-keys')

        expect(res.status).toBe(200)
        expect(res.body.keys).toEqual([])
        expect(res.body.limits.current).toBe(0)
    })
})

describe('POST /api/api-keys', () => {
    let app

    beforeEach(() => {
        app = createApp()
        mockPrepare.mockReset()
        vi.mocked(generateApiKey).mockReturnValue({
            id: 'generated-uuid-1',
            key: 'grm_live_mock_generated_key_abcdef',
            prefix: 'grm_live_mock_ge',
            keyHash: 'mockhash123abc',
        })
        vi.mocked(getFeatures).mockReturnValue({ apiKeys: 5 })
        vi.mocked(auditLog).mockClear()
    })

    it('creates key with valid data', async () => {
        // Mock COUNT query for tier limit check
        mockPrepare
            .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ n: 1 }) }) // current count
            .mockReturnValueOnce({ run: vi.fn() }) // INSERT

        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'CI Key', scopes: ['read', 'write'] })

        expect(res.status).toBe(201)
        expect(res.body.id).toBe('generated-uuid-1')
        expect(res.body.key).toBe('grm_live_mock_generated_key_abcdef')
        expect(res.body.name).toBe('CI Key')
        expect(res.body.prefix).toBe('grm_live_mock_ge')
        expect(res.body.scopes).toEqual(['read', 'write'])
        expect(auditLog).toHaveBeenCalledWith(
            expect.anything(),
            'api_key.create',
            'api_key',
            'generated-uuid-1',
            { name: 'CI Key', scopes: ['read', 'write'] }
        )
    })

    it('creates key with default scopes when none provided', async () => {
        mockPrepare
            .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ n: 0 }) })
            .mockReturnValueOnce({ run: vi.fn() })

        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'Minimal Key' })

        expect(res.status).toBe(201)
        expect(res.body.scopes).toEqual(['read'])
    })

    it('creates key with expires_at', async () => {
        mockPrepare
            .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ n: 0 }) })
            .mockReturnValueOnce({ run: vi.fn() })

        const res = await request(app)
            .post('/api/api-keys')
            .send({
                name: 'Expiring Key',
                scopes: ['read'],
                expires_at: '2099-12-31T23:59:59Z',
            })

        expect(res.status).toBe(201)
        expect(res.body.expires_at).toBe('2099-12-31T23:59:59Z')
    })

    it('rejects when name is missing', async () => {
        const res = await request(app)
            .post('/api/api-keys')
            .send({ scopes: ['read'] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Invalid input')
    })

    it('rejects when name is empty string', async () => {
        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: '', scopes: ['read'] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Invalid input')
    })

    it('rejects invalid scope values', async () => {
        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'Bad Scopes', scopes: ['delete_all'] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Invalid input')
    })

    it('rejects name exceeding max length', async () => {
        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'A'.repeat(101), scopes: ['read'] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Invalid input')
    })

    it('enforces tier limit', async () => {
        // Simulate already at limit (5 active keys, limit is 5)
        mockPrepare.mockReturnValue({
            get: vi.fn().mockReturnValue({ n: 5 }),
        })

        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'Over Limit', scopes: ['read'] })

        expect(res.status).toBe(403)
        expect(res.body.code).toBe('tier_limit_exceeded')
        expect(res.body.limit).toBe(5)
        expect(res.body.upgradeUrl).toBe('/pricing')
    })

    it('allows creation when exactly at limit minus one', async () => {
        mockPrepare
            .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ n: 4 }) })
            .mockReturnValueOnce({ run: vi.fn() })

        const res = await request(app)
            .post('/api/api-keys')
            .send({ name: 'Last Slot', scopes: ['read'] })

        expect(res.status).toBe(201)
    })
})

describe('DELETE /api/api-keys/:id', () => {
    let app

    beforeEach(() => {
        app = createApp()
        mockPrepare.mockReset()
        vi.mocked(auditLog).mockClear()
    })

    it('revokes existing key', async () => {
        mockPrepare.mockReturnValue({
            run: vi.fn().mockReturnValue({ changes: 1 }),
        })

        const res = await request(app).delete('/api/api-keys/key-abc')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(auditLog).toHaveBeenCalledWith(
            expect.anything(),
            'api_key.revoke',
            'api_key',
            'key-abc'
        )
    })

    it('returns 404 for non-existent key', async () => {
        mockPrepare.mockReturnValue({
            run: vi.fn().mockReturnValue({ changes: 0 }),
        })

        const res = await request(app).delete('/api/api-keys/nonexistent-id')

        expect(res.status).toBe(404)
        expect(res.body.error).toBe('Key not found or already revoked')
    })

    it('returns 404 for already revoked key', async () => {
        // The SQL includes "AND revoked_at IS NULL", so already-revoked returns changes: 0
        mockPrepare.mockReturnValue({
            run: vi.fn().mockReturnValue({ changes: 0 }),
        })

        const res = await request(app).delete('/api/api-keys/already-revoked')

        expect(res.status).toBe(404)
        expect(res.body.error).toBe('Key not found or already revoked')
    })

    it('does not call auditLog when key not found', async () => {
        mockPrepare.mockReturnValue({
            run: vi.fn().mockReturnValue({ changes: 0 }),
        })

        await request(app).delete('/api/api-keys/missing')

        expect(auditLog).not.toHaveBeenCalled()
    })
})
