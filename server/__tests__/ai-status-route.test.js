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

function createApp({ userProvider = null } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId: 99 };
        // attachAIProvider() installs this in production; supplying it here is
        // what makes a request look like it came from a BYOK user.
        if (userProvider) req.getAIProvider = async () => userProvider;
        next();
    });
    app.use('/api', coreRouter);
    return app;
}

// Run `fn` with the server-wide aiService reporting no key at all — the
// BYOK-only deployment shape that .env.example recommends.
async function withNoServerKey(fn) {
    delete process.env.GEMINI_API_KEY;
    const realAi = await import('../ai-service.js');
    const stash = realAi.aiService.provider;
    Object.defineProperty(realAi.aiService, 'model', { configurable: true, get() { return null; } });
    Object.defineProperty(realAi.aiService, 'provider', { configurable: true, get() { return null; } });
    try {
        return await fn();
    } finally {
        Object.defineProperty(realAi.aiService, 'model', { configurable: true, get() { return mockProvider.model; } });
        Object.defineProperty(realAi.aiService, 'provider', { configurable: true, get() { return stash; } });
    }
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
        await withNoServerKey(async () => {
            const res = await request(createApp()).get('/api/config/ai-status');
            expect(res.body).toEqual({
                configured: false,
                provider: null,
                keyHealth: 'unknown',
                lastCheckedAt: null,
            });
        });
    });

    it('reports configured=true from the user own key when the server has none', async () => {
        // The BYOK-only deployment. Reading `configured` off the server key
        // alone told these users "AI is not configured" while their own key
        // worked, and the client pre-empted every AI call because of it.
        await withNoServerKey(async () => {
            const byok = {
                id: 'anthropic',
                generate: (...args) => mockGenerate(...args),
                getModelName: () => 'claude-sonnet-4',
            };
            const res = await request(createApp({ userProvider: byok })).get('/api/config/ai-status');
            expect(res.body.configured).toBe(true);
            expect(res.body.provider).toBe('anthropic');
        });
    });
});

// ---------------------------------------------------------------------------
// Denial-of-wallet: ?probe=1 drives a real provider.generate() and deliberately
// bypasses the 5-minute cache. The route carries no requireAuth, so an
// anonymous caller could spend the operator's key once per request, as fast as
// the rate limiter allowed.
// ---------------------------------------------------------------------------
function createAnonApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = {}; next(); });
    app.use('/api', coreRouter);
    return app;
}

describe('GET /api/config/ai-status?probe=1 — anonymous callers', () => {
    it('refuses to force a probe without a session, and never calls the provider', async () => {
        const res = await request(createAnonApp()).get('/api/config/ai-status?probe=1');
        expect(res.status).toBe(401);
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('still serves the status read to an anonymous caller', async () => {
        // The unauthenticated status read is what the client uses to decide
        // whether to offer AI at all — only the forced probe is privileged.
        const res = await request(createAnonApp()).get('/api/config/ai-status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('configured');
    });

    it('cannot be used to drive unbounded provider calls', async () => {
        // The unforced read warms a 5-minute cache, so a burst collapses to a
        // single provider call. That bound is the whole defence — and bypassing
        // it is precisely what ?probe=1 does.
        const app = createAnonApp();
        for (let i = 0; i < 5; i++) await request(app).get('/api/config/ai-status');
        await new Promise((r) => setTimeout(r, 20));
        expect(mockGenerate.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('a signed-in caller can still force a probe', async () => {
        const res = await request(createApp()).get('/api/config/ai-status?probe=1');
        expect(res.status).toBe(200);
        expect(mockGenerate).toHaveBeenCalled();
    });
});
