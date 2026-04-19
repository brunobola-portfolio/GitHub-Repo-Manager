// @vitest-environment node
/**
 * Route integration tests for /api/user/ai-config
 *
 * Verifies:
 *  - GET returns null-shape before config exists
 *  - POST persists config, subsequent GET shows hasCompletionKey: true but no key
 *  - POST /test with mocked provider returns { ok: true }
 *  - DELETE removes config
 *  - 401 without auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// In-memory store for user-ai-config mock
// ---------------------------------------------------------------------------

let _store = null;
const USER_ID = 42;

function makePublicShape(row) {
    if (!row) return null;
    return {
        userId: row.userId,
        completionProvider: row.completionProvider ?? null,
        completionModel: row.completionModel ?? null,
        hasCompletionKey: !!row._compKey,
        embeddingProvider: row.embeddingProvider ?? null,
        embeddingModel: row.embeddingModel ?? null,
        hasEmbeddingKey: !!row._embKey,
        updatedAt: null,
    };
}

vi.mock('../lib/user-ai-config.js', () => ({
    getUserAIConfig: vi.fn((userId) => {
        if (!_store || _store.userId !== userId) return null;
        return makePublicShape(_store);
    }),
    getDecryptedConfig: vi.fn((userId) => {
        if (!_store || _store.userId !== userId) return null;
        return {
            userId: _store.userId,
            completionProvider: _store.completionProvider ?? null,
            completionModel: _store.completionModel ?? null,
            completionCredentials: _store._compKey ? { apiKey: _store._compKey } : null,
            embeddingProvider: _store.embeddingProvider ?? null,
            embeddingModel: _store.embeddingModel ?? null,
            embeddingCredentials: _store._embKey ? { apiKey: _store._embKey } : null,
        };
    }),
    setUserAIConfig: vi.fn((userId, config) => {
        if (!_store) _store = { userId };
        if (config.completionProvider !== undefined) _store.completionProvider = config.completionProvider;
        if (config.completionModel !== undefined) _store.completionModel = config.completionModel;
        if (config.completionCredentials !== undefined) {
            _store._compKey = config.completionCredentials?.apiKey ?? null;
        }
        if (config.embeddingProvider !== undefined) _store.embeddingProvider = config.embeddingProvider;
        if (config.embeddingModel !== undefined) _store.embeddingModel = config.embeddingModel;
        if (config.embeddingCredentials !== undefined) {
            _store._embKey = config.embeddingCredentials?.apiKey ?? null;
        }
    }),
    deleteUserAIConfig: vi.fn((userId) => {
        if (_store?.userId === userId) _store = null;
    }),
}));

// ---------------------------------------------------------------------------
// Mock createProviderForUser
// ---------------------------------------------------------------------------

const mockGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockProvider = {
    _modelName: 'mock-model',
    _embeddingModelName: 'mock-embed',
    generate: mockGenerate,
    embed: mockEmbed,
};

const mockCreateProviderForUser = vi.fn().mockResolvedValue(mockProvider);

vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: (...args) => mockCreateProviderForUser(...args),
    AIError: class AIError extends Error {
        constructor({ code, message, status } = {}) {
            super(message || code);
            this.code = code;
            this.status = status;
        }
    },
    AI_ERROR_CODE: {
        QUOTA: 'QUOTA', AUTH: 'AUTH', OVERLOAD: 'OVERLOAD',
        NOT_FOUND: 'NOT_FOUND', INVALID_RESPONSE: 'INVALID_RESPONSE',
        CANCELED: 'CANCELED', UNKNOWN: 'UNKNOWN',
    },
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        next();
    },
    safeError: (err, fallback) => err?.message || fallback,
}));

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

// Import router AFTER all mocks are set up
const { default: userAIConfigRouter, testLastCall } = await import('../routes/user-ai-config.js');

function createApp(authed = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (authed) {
            req.session = { userId: USER_ID };
        } else {
            req.session = {};
        }
        next();
    });
    app.use('/api/user/ai-config', userAIConfigRouter);
    return app;
}

// ---------------------------------------------------------------------------
// Reset state
// ---------------------------------------------------------------------------

beforeEach(() => {
    _store = null;
    testLastCall.clear(); // reset rate limiter state between tests
    mockGenerate.mockClear();
    mockEmbed.mockClear();
    mockCreateProviderForUser.mockResolvedValue(mockProvider);
    mockGenerate.mockResolvedValue({ text: 'ok' });
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

// ---------------------------------------------------------------------------
// GET /api/user/ai-config
// ---------------------------------------------------------------------------

describe('GET /api/user/ai-config', () => {
    it('returns null-shape when no config exists', async () => {
        const app = createApp(true);
        const res = await request(app).get('/api/user/ai-config');

        expect(res.status).toBe(200);
        expect(res.body.completionProvider).toBeNull();
        expect(res.body.hasCompletionKey).toBe(false);
        expect(res.body.hasEmbeddingKey).toBe(false);
    });

    it('returns 401 without auth', async () => {
        const app = createApp(false);
        const res = await request(app).get('/api/user/ai-config');

        expect(res.status).toBe(401);
    });

    it('returns public shape after config is set', async () => {
        _store = {
            userId: USER_ID,
            completionProvider: 'openai',
            completionModel: 'gpt-4o',
            _compKey: 'sk-secret',
        };

        const app = createApp(true);
        const res = await request(app).get('/api/user/ai-config');

        expect(res.status).toBe(200);
        expect(res.body.completionProvider).toBe('openai');
        expect(res.body.completionModel).toBe('gpt-4o');
        expect(res.body.hasCompletionKey).toBe(true);
        // Must NOT expose the actual key
        expect(res.body.completionApiKey).toBeUndefined();
        expect(res.body.completionCredentials).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// POST /api/user/ai-config
// ---------------------------------------------------------------------------

describe('POST /api/user/ai-config', () => {
    it('returns 204 on success', async () => {
        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config')
            .send({ completionProvider: 'openai', completionApiKey: 'sk-abc' });

        expect(res.status).toBe(204);
    });

    it('subsequent GET shows hasCompletionKey: true but no key', async () => {
        const app = createApp(true);

        await request(app)
            .post('/api/user/ai-config')
            .send({ completionProvider: 'anthropic', completionApiKey: 'sk-ant-abc' });

        const getRes = await request(app).get('/api/user/ai-config');

        expect(getRes.status).toBe(200);
        expect(getRes.body.hasCompletionKey).toBe(true);
        expect(getRes.body).not.toHaveProperty('completionApiKey');
    });

    it('returns 400 for invalid provider', async () => {
        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config')
            .send({ completionProvider: 'invalid-provider' });

        expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
        const app = createApp(false);
        const res = await request(app)
            .post('/api/user/ai-config')
            .send({ completionProvider: 'openai' });

        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// DELETE /api/user/ai-config
// ---------------------------------------------------------------------------

describe('DELETE /api/user/ai-config', () => {
    it('returns 204 and clears the config', async () => {
        _store = { userId: USER_ID, completionProvider: 'openai', _compKey: 'sk-abc' };

        const app = createApp(true);
        const delRes = await request(app).delete('/api/user/ai-config');
        expect(delRes.status).toBe(204);

        const getRes = await request(app).get('/api/user/ai-config');
        expect(getRes.body.hasCompletionKey).toBe(false);
    });

    it('returns 401 without auth', async () => {
        const app = createApp(false);
        const res = await request(app).delete('/api/user/ai-config');
        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// POST /api/user/ai-config/test
// ---------------------------------------------------------------------------

describe('POST /api/user/ai-config/test', () => {
    it('returns { ok: true } when completion call succeeds', async () => {
        const completionMockProvider = {
            _modelName: 'gpt-4o',
            _embeddingModelName: null,
            generate: vi.fn().mockResolvedValue({ text: 'ok' }),
            embed: vi.fn(),
        };
        mockCreateProviderForUser.mockResolvedValue(completionMockProvider);

        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'completion' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(typeof res.body.latencyMs).toBe('number');
    });

    it('returns { ok: true } when embedding call succeeds', async () => {
        const embeddingMockProvider = {
            _modelName: 'embed-model',
            _embeddingModelName: 'embed-model',
            generate: vi.fn(),
            embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };
        mockCreateProviderForUser.mockResolvedValue(embeddingMockProvider);

        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'embedding' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dimensions).toBe(3);
    });

    it('returns { ok: false } when provider is null (not configured)', async () => {
        mockCreateProviderForUser.mockResolvedValue(null);

        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'completion' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('NOT_CONFIGURED');
    });

    it('returns { ok: false, error } when generate throws', async () => {
        const failingProvider = {
            _modelName: 'gpt-4o',
            _embeddingModelName: null,
            generate: vi.fn().mockRejectedValue({ code: 'AUTH', message: 'Invalid API key' }),
            embed: vi.fn(),
        };
        mockCreateProviderForUser.mockResolvedValue(failingProvider);

        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'completion' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
    });

    it('returns 400 for invalid kind', async () => {
        const app = createApp(true);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'invalid' });

        expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
        const app = createApp(false);
        const res = await request(app)
            .post('/api/user/ai-config/test')
            .send({ kind: 'completion' });

        expect(res.status).toBe(401);
    });
});
