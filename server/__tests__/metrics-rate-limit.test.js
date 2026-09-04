// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * GET /metrics — the per-IP ceiling and the JSON error body.
 *
 * /metrics is mounted outside /api/*, so neither the global safety-net limiter
 * nor the per-tenant apiLimiter reaches it: the METRICS_TOKEN bearer path had
 * no rate ceiling of any kind, the only sensitive endpoint in the process
 * without one. Its 500 path was also the only non-JSON, non-safeError body in
 * the server — a raw `res.end(err.message)`.
 *
 * Lives in its own file because the limiter is module-scope state keyed on the
 * client IP: exhausting the window here would 429 every other test in
 * metrics.test.js.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const metricsMock = vi.fn(async () => '# HELP test\n');

vi.mock('../lib/metrics.js', () => ({
    register: {
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        get metrics() { return metricsMock; },
    },
    metricsMiddleware: (_req, _res, next) => next(),
}));

const { default: metricsRouter } = await import('../routes/metrics.js');

const TOKEN = 'metrics-token-for-tests';
const ORIGINAL_TOKEN = process.env.METRICS_TOKEN;

function buildApp() {
    const app = express();
    app.use('/metrics', metricsRouter);
    return app;
}

function scrape(app) {
    return request(app).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
    process.env.METRICS_TOKEN = TOKEN;
    metricsMock.mockReset().mockResolvedValue('# HELP test\n');
});

afterAll(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = ORIGINAL_TOKEN;
});

describe('GET /metrics error body', () => {
    it('answers JSON with a code when collection fails, not the raw message', async () => {
        metricsMock.mockRejectedValue(new Error('registry exploded: postgres://user:pw@host'));

        const res = await scrape(buildApp());

        expect(res.status).toBe(500);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.code).toBe('SERVER_ERROR');
        expect(typeof res.body.error).toBe('string');
    });
});

describe('GET /metrics rate limit', () => {
    // Runs last: it deliberately exhausts the window, and the limiter's memory
    // store is shared by every request in this module.
    it('caps a single IP at 120 requests per minute', async () => {
        const app = buildApp();

        // 1 request was already spent by the error-body test above; the limiter
        // counts every response, including the 500. Drive well past the cap and
        // assert the transition rather than an exact request number.
        let firstBlockedAt = null;
        for (let i = 1; i <= 130 && firstBlockedAt === null; i++) {
            const res = await scrape(app);
            if (res.status === 429) firstBlockedAt = i;
        }

        expect(firstBlockedAt).not.toBeNull();
        expect(firstBlockedAt).toBeLessThanOrEqual(120);

        const blocked = await scrape(app);
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('RATE_LIMITED');
    }, 30_000);
});
