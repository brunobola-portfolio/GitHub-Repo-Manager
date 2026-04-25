// @vitest-environment node
/**
 * Route integration tests for GET /api/config/ai-status.
 *
 * Verifies the public response shape — { configured, provider, keyHealth,
 * lastCheckedAt } — and that ?probe=1 forces a synchronous probe so the
 * UI can warm the cache after a Test Connection success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
const mockProvider = {
    generate: (...args) => mockGenerate(...args),
    getModelName: () => 'gemini-2.5-flash',
    rawSDK: {},
    model: {},
    embeddingModel: {},
};

vi.mock('../ai-service.js', () => ({
    aiService: {
        get provider() { return mockProvider; },
        get model() { return mockProvider.model; },
    },
    sanitizeForPrompt: (s) => s,
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Reset the in-memory cache between tests so probe state never bleeds.
const probeMod = await import('../lib/ai-health-probe.js');

// Import the router after mocks are in place.
const { default: coreRouter } = await import('../routes/ai/core.js');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId: 99 };
        next();
    });
    app.use('/api', coreRouter);
    return app;
}

beforeEach(() => {
    probeMod.invalidate();
    mockGenerate.mockClear();
    mockGenerate.mockResolvedValue({ text: 'ok' });
    process.env.GEMINI_API_KEY = 'AIza-test';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/config/ai-status', () => {
    it('returns the new shape with configured/provider/keyHealth/lastCheckedAt', async () => {
        const res = await request(createApp()).get('/api/config/ai-status');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            configured: true,
            provider: 'gemini',
            keyHealth: expect.any(String),
        });
        // lastCheckedAt is null on the first call (probe still running).
        expect(['string', 'object']).toContain(typeof res.body.lastCheckedAt);
    });

    it('first call returns "unknown" without blocking, then "ok" after the probe lands', async () => {
        const first = await request(createApp()).get('/api/config/ai-status');
        expect(first.body.keyHealth).toBe('unknown');

        // Allow the background probe to complete.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        const second = await request(createApp()).get('/api/config/ai-status');
        expect(second.body.keyHealth).toBe('ok');
        expect(second.body.lastCheckedAt).toEqual(expect.any(String));
        expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('?probe=1 runs the probe synchronously and returns the result immediately', async () => {
        const res = await request(createApp()).get('/api/config/ai-status?probe=1');
        expect(res.status).toBe(200);
        expect(res.body.keyHealth).toBe('ok');
        expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('reports keyHealth=invalid when the probe throws an auth error', async () => {
        mockGenerate.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
        const res = await request(createApp()).get('/api/config/ai-status?probe=1');
        expect(res.body.keyHealth).toBe('invalid');
    });

    it('returns configured=false when no provider key is set anywhere', async () => {
        delete process.env.GEMINI_API_KEY;
        // Re-import without aiService.model so the configured branch is false.
        // The route also checks aiService.model — easiest is to hide the SDK
        // models on the mocked aiService for this case.
        const realAi = await import('../ai-service.js');
        const stash = realAi.aiService.provider;
        Object.defineProperty(realAi.aiService, 'model', { configurable: true, get() { return null; } });
        Object.defineProperty(realAi.aiService, 'provider', { configurable: true, get() { return null; } });

        try {
            const res = await request(createApp()).get('/api/config/ai-status');
            expect(res.body).toEqual({
                configured: false,
                provider: null,
                keyHealth: 'unknown',
                lastCheckedAt: null,
            });
        } finally {
            Object.defineProperty(realAi.aiService, 'model', { configurable: true, get() { return mockProvider.model; } });
            Object.defineProperty(realAi.aiService, 'provider', { configurable: true, get() { return stash; } });
        }
    });
});
