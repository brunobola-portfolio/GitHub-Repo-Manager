// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

// Mock db module before importing the module under test
vi.mock('../db.js', () => {
    const mockPrepare = vi.fn()
    return {
        default: { prepare: mockPrepare },
        __mockPrepare: mockPrepare,
    }
})

// Mock logger to suppress output
vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

import { default as _db, __mockPrepare as mockPrepare } from '../db.js'
import { hashKey, generateApiKey, apiKeyAuth, requireScope } from '../middleware/api-key-auth.js'

describe('hashKey', () => {
    const originalSecret = process.env.API_KEY_SECRET

    afterEach(() => {
        if (originalSecret !== undefined) {
            process.env.API_KEY_SECRET = originalSecret
        } else {
            delete process.env.API_KEY_SECRET
        }
    })

    it('produces consistent HMAC-SHA-256 output for the same input', () => {
        const result1 = hashKey('test-key-value')
        const result2 = hashKey('test-key-value')
        expect(result1).toBe(result2)
    })

    it('produces a valid hex string', () => {
        const result = hashKey('some-api-key')
        expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('generates an ephemeral dev secret when API_KEY_SECRET is unset (non-prod)', () => {
        delete process.env.API_KEY_SECRET
        const key = 'grm_live_test123'
        const hash = hashKey(key)
        // Should produce a valid hex hash without throwing
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        // Ephemeral secret is now persisted on env for the rest of the process
        expect(process.env.API_KEY_SECRET).toBeTruthy()
        expect(process.env.API_KEY_SECRET).toHaveLength(64) // 32 bytes hex
    })

    it('throws in production when API_KEY_SECRET is missing (no insecure default)', () => {
        const originalNodeEnv = process.env.NODE_ENV
        delete process.env.API_KEY_SECRET
        process.env.NODE_ENV = 'production'
        try {
            expect(() => hashKey('grm_live_test')).toThrow(/API_KEY_SECRET must be set in production/)
        } finally {
            process.env.NODE_ENV = originalNodeEnv
        }
    })

    it('output changes when API_KEY_SECRET env changes', () => {
        process.env.API_KEY_SECRET = 'first-secret-value'
        const hashFirst = hashKey('same-key')

        process.env.API_KEY_SECRET = 'custom-secret-value'
        const hashWithCustom = hashKey('same-key')

        expect(hashFirst).not.toBe(hashWithCustom)
    })

    it('uses custom API_KEY_SECRET when set', () => {
        process.env.API_KEY_SECRET = 'my-production-secret'
        const key = 'grm_live_abc'
        const expected = createHmac('sha256', 'my-production-secret')
            .update(key)
            .digest('hex')
        expect(hashKey(key)).toBe(expected)
    })

    it('produces different hashes for different keys', () => {
        const hash1 = hashKey('key-one')
        const hash2 = hashKey('key-two')
        expect(hash1).not.toBe(hash2)
    })
})

describe('generateApiKey', () => {
    it('returns correct structure with all required fields', () => {
        const result = generateApiKey()
        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('key')
        expect(result).toHaveProperty('prefix')
        expect(result).toHaveProperty('keyHash')
    })

    it('key starts with grm_live_ prefix', () => {
        const { key } = generateApiKey()
        expect(key.startsWith('grm_live_')).toBe(true)
    })

    it('prefix is first 16 characters of the key', () => {
        const { key, prefix } = generateApiKey()
        expect(prefix).toBe(key.slice(0, 16))
        expect(prefix).toHaveLength(16)
    })

    it('id is a valid UUID', () => {
        const { id } = generateApiKey()
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })

    it('keyHash matches hashKey(key)', () => {
        const { key, keyHash } = generateApiKey()
        expect(keyHash).toBe(hashKey(key))
    })

    it('produces unique keys on consecutive calls', () => {
        const results = Array.from({ length: 10 }, () => generateApiKey())
        const keys = results.map((r) => r.key)
        const ids = results.map((r) => r.id)
        const hashes = results.map((r) => r.keyHash)

        expect(new Set(keys).size).toBe(10)
        expect(new Set(ids).size).toBe(10)
        expect(new Set(hashes).size).toBe(10)
    })
})

describe('apiKeyAuth middleware', () => {
    let req, res, next

    beforeEach(() => {
        req = {
            headers: {},
            session: {},
            ip: '127.0.0.1',
            socket: { remoteAddress: '127.0.0.1' },
        }
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        }
        next = vi.fn()
        mockPrepare.mockReset()
    })

    it('calls next() without setting context when no Bearer grm_live_ header', () => {
        req.headers.authorization = undefined
        apiKeyAuth(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
        expect(req.apiKeyId).toBeUndefined()
    })

    it('calls next() for non-grm Bearer tokens (passes through)', () => {
        req.headers.authorization = 'Bearer ghp_abc123'
        apiKeyAuth(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('returns 401 for invalid API key (not found in DB)', () => {
        req.headers.authorization = 'Bearer grm_live_invalid_key_here'
        mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) })

        apiKeyAuth(req, res, next)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' })
        expect(next).not.toHaveBeenCalled()
    })

    it('returns 401 for revoked key', () => {
        req.headers.authorization = 'Bearer grm_live_some_key_value'
        mockPrepare.mockReturnValue({
            get: vi.fn().mockReturnValue({
                id: 'key-1',
                user_id: 42,
                scopes: '["read"]',
                expires_at: null,
                revoked_at: '2025-01-01T00:00:00Z',
            }),
        })

        apiKeyAuth(req, res, next)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'API key has been revoked' })
        expect(next).not.toHaveBeenCalled()
    })

    it('returns 401 for expired key', () => {
        req.headers.authorization = 'Bearer grm_live_expired_key_here'
        mockPrepare.mockReturnValue({
            get: vi.fn().mockReturnValue({
                id: 'key-2',
                user_id: 42,
                scopes: '["read"]',
                expires_at: '2020-01-01T00:00:00Z',
                revoked_at: null,
            }),
        })

        apiKeyAuth(req, res, next)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'API key has expired' })
        expect(next).not.toHaveBeenCalled()
    })

    it('sets user context and calls next for valid key', () => {
        req.headers.authorization = 'Bearer grm_live_valid_key_here'
        const mockGet = vi.fn().mockReturnValue({
            id: 'key-3',
            user_id: 99,
            scopes: '["read","write"]',
            expires_at: '2099-12-31T23:59:59Z',
            revoked_at: null,
        })
        const mockRun = vi.fn()
        mockPrepare
            .mockReturnValueOnce({ get: mockGet })  // SELECT query
            .mockReturnValueOnce({ run: mockRun })   // UPDATE last_used_at

        apiKeyAuth(req, res, next)

        expect(next).toHaveBeenCalled()
        expect(req.session.userId).toBe(99)
        expect(req.tenantId).toBe(99)
        expect(req.apiKeyId).toBe('key-3')
        expect(req.scopes).toEqual(['read', 'write'])
    })

    it('sets empty scopes when JSON parsing fails', () => {
        req.headers.authorization = 'Bearer grm_live_bad_scope_key'
        const mockGet = vi.fn().mockReturnValue({
            id: 'key-4',
            user_id: 50,
            scopes: 'not-valid-json',
            expires_at: null,
            revoked_at: null,
        })
        const mockRun = vi.fn()
        mockPrepare
            .mockReturnValueOnce({ get: mockGet })
            .mockReturnValueOnce({ run: mockRun })

        apiKeyAuth(req, res, next)

        expect(next).toHaveBeenCalled()
        expect(req.scopes).toEqual([])
    })

    it('allows key with no expiration (expires_at null)', () => {
        req.headers.authorization = 'Bearer grm_live_no_expiry_key'
        const mockGet = vi.fn().mockReturnValue({
            id: 'key-5',
            user_id: 77,
            scopes: '["admin"]',
            expires_at: null,
            revoked_at: null,
        })
        const mockRun = vi.fn()
        mockPrepare
            .mockReturnValueOnce({ get: mockGet })
            .mockReturnValueOnce({ run: mockRun })

        apiKeyAuth(req, res, next)

        expect(next).toHaveBeenCalled()
        expect(req.apiKeyId).toBe('key-5')
    })

    it('updates last_used_at with IP and user-agent', () => {
        req.headers.authorization = 'Bearer grm_live_usage_tracking'
        req.headers['user-agent'] = 'TestAgent/1.0'
        req.ip = '10.0.0.1'
        const mockGet = vi.fn().mockReturnValue({
            id: 'key-6',
            user_id: 88,
            scopes: '["read"]',
            expires_at: null,
            revoked_at: null,
        })
        const mockRun = vi.fn()
        mockPrepare
            .mockReturnValueOnce({ get: mockGet })
            .mockReturnValueOnce({ run: mockRun })

        apiKeyAuth(req, res, next)

        expect(mockRun).toHaveBeenCalledWith('10.0.0.1', 'TestAgent/1.0', 'key-6')
    })

    it('initializes req.session if undefined', () => {
        req.session = undefined
        req.headers.authorization = 'Bearer grm_live_no_session'
        const mockGet = vi.fn().mockReturnValue({
            id: 'key-7',
            user_id: 33,
            scopes: '["read"]',
            expires_at: null,
            revoked_at: null,
        })
        const mockRun = vi.fn()
        mockPrepare
            .mockReturnValueOnce({ get: mockGet })
            .mockReturnValueOnce({ run: mockRun })

        apiKeyAuth(req, res, next)

        expect(req.session).toBeDefined()
        expect(req.session.userId).toBe(33)
    })
})

describe('requireScope', () => {
    let res, next

    beforeEach(() => {
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        }
        next = vi.fn()
    })

    it('allows matching scope', () => {
        const middleware = requireScope('read')
        const req = { apiKeyId: 'key-1', scopes: ['read', 'write'], session: {} }

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('allows admin scope for any required scope', () => {
        const middleware = requireScope('write')
        const req = { apiKeyId: 'key-2', scopes: ['admin'], session: {} }

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('denies when scope is missing', () => {
        const middleware = requireScope('admin')
        const req = { apiKeyId: 'key-3', scopes: ['read'], session: {} }

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Insufficient permissions',
            required: 'admin',
        })
    })

    it('passes through session-based auth (no apiKeyId)', () => {
        const middleware = requireScope('write')
        const req = { session: { userId: 42 }, scopes: undefined }

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('denies when no session and no scopes', () => {
        const middleware = requireScope('read')
        const req = { apiKeyId: 'key-4', scopes: [], session: {} }

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
    })

    it('denies when scopes is undefined on API key request', () => {
        const middleware = requireScope('read')
        const req = { apiKeyId: 'key-5', scopes: undefined, session: {} }

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
    })

    it('session-based auth passes even without scopes property', () => {
        const middleware = requireScope('admin')
        const req = { session: { userId: 100 } }
        // no apiKeyId, no scopes

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
    })
})
