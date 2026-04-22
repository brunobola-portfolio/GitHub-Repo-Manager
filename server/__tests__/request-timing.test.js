// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the shared logger BEFORE importing the middleware so the middleware
// picks up the mocked default export. This lets us assert on the exact
// level + payload the middleware emits when req.log is absent.
vi.mock('../lib/logger.js', () => {
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    };
    return { default: logger };
});

import logger from '../lib/logger.js';
import { requestTiming } from '../middleware/request-timing.js';

function makeApp(handler) {
    const app = express();
    app.use(requestTiming);
    app.get('/ok', (req, res) => res.status(200).json({ ok: true }));
    app.get('/slow', async (_req, res) => {
        // Trip the >1000ms "slow" branch without actually waiting — we can
        // patch process.hrtime.bigint for this specific request via the
        // delay middleware below.
        await new Promise((r) => setTimeout(r, 1100));
        res.status(200).json({ slow: true });
    });
    app.get('/bad', (_req, res) => res.status(404).json({ error: 'nope' }));
    app.get('/boom', (_req, res) => res.status(500).json({ error: 'boom' }));
    if (handler) handler(app);
    return app;
}

describe('requestTiming middleware', () => {
    beforeEach(() => {
        logger.debug.mockClear();
        logger.info.mockClear();
        logger.warn.mockClear();
        logger.error.mockClear();
    });

    it('logs at debug level with durationMs for 2xx responses', async () => {
        const app = makeApp();
        const res = await request(app).get('/ok');
        expect(res.status).toBe(200);
        expect(logger.debug).toHaveBeenCalledTimes(1);
        const [payload, msg] = logger.debug.mock.calls[0];
        expect(msg).toBe('request:ok');
        expect(payload.method).toBe('GET');
        expect(payload.path).toBe('/ok');
        expect(payload.status).toBe(200);
        expect(typeof payload.durationMs).toBe('number');
        expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('logs at warn level for 4xx responses', async () => {
        const app = makeApp();
        await request(app).get('/bad');
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [payload, msg] = logger.warn.mock.calls[0];
        expect(msg).toBe('request:warn');
        expect(payload.status).toBe(404);
    });

    it('logs at error level for 5xx responses', async () => {
        const app = makeApp();
        await request(app).get('/boom');
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [payload, msg] = logger.error.mock.calls[0];
        expect(msg).toBe('request:error');
        expect(payload.status).toBe(500);
    });

    it('logs at warn level with request:slow when 2xx but duration > 1s', async () => {
        const app = makeApp();
        await request(app).get('/slow');
        // The slow branch should have emitted exactly one warn with the
        // "request:slow" message — no debug/error/info.
        expect(logger.debug).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [payload, msg] = logger.warn.mock.calls[0];
        expect(msg).toBe('request:slow');
        expect(payload.status).toBe(200);
        expect(payload.durationMs).toBeGreaterThan(1000);
    }, 10000);

    it('prefers req.log when attached by an upstream middleware', async () => {
        const reqLog = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const app = express();
        app.use((req, _res, next) => { req.log = reqLog; next(); });
        app.use(requestTiming);
        app.get('/', (_req, res) => res.status(200).end());

        await request(app).get('/');
        expect(reqLog.debug).toHaveBeenCalledTimes(1);
        // The shared module logger should NOT receive the entry because
        // req.log took precedence.
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it('includes userId from req.session when present', async () => {
        const app = express();
        app.use((req, _res, next) => { req.session = { userId: 42 }; next(); });
        app.use(requestTiming);
        app.get('/', (_req, res) => res.status(200).end());

        await request(app).get('/');
        const [payload] = logger.debug.mock.calls[0];
        expect(payload.userId).toBe(42);
    });
});
